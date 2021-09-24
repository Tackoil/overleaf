const request = require('request').defaults({ timeout: 30 * 1000 })
const OError = require('@overleaf/o-error')
const settings = require('@overleaf/settings')
const _ = require('underscore')
const async = require('async')
const logger = require('logger-sharelatex')
const metrics = require('@overleaf/metrics')
const { promisify } = require('util')

module.exports = {
  flushProjectToMongo,
  flushMultipleProjectsToMongo,
  flushProjectToMongoAndDelete,
  flushDocToMongo,
  deleteDoc,
  getDocument,
  setDocument,
  getProjectDocsIfMatch,
  clearProjectState,
  acceptChanges,
  deleteThread,
  resyncProjectHistory,
  updateProjectStructure,
  promises: {
    flushProjectToMongo: promisify(flushProjectToMongo),
    flushMultipleProjectsToMongo: promisify(flushMultipleProjectsToMongo),
    flushProjectToMongoAndDelete: promisify(flushProjectToMongoAndDelete),
    flushDocToMongo: promisify(flushDocToMongo),
    deleteDoc: promisify(deleteDoc),
    getDocument: promisify(getDocument),
    setDocument: promisify(setDocument),
    getProjectDocsIfMatch: promisify(getProjectDocsIfMatch),
    clearProjectState: promisify(clearProjectState),
    acceptChanges: promisify(acceptChanges),
    deleteThread: promisify(deleteThread),
    resyncProjectHistory: promisify(resyncProjectHistory),
    updateProjectStructure: promisify(updateProjectStructure),
  },
}

function flushProjectToMongo(projectId, callback) {
  _makeRequest(
    {
      path: `/project/${projectId}/flush`,
      method: 'POST',
    },
    projectId,
    'flushing.mongo.project',
    callback
  )
}

function flushMultipleProjectsToMongo(projectIds, callback) {
  const jobs = projectIds.map(projectId => callback => {
    flushProjectToMongo(projectId, callback)
  })
  async.series(jobs, callback)
}

function flushProjectToMongoAndDelete(projectId, callback) {
  _makeRequest(
    {
      path: `/project/${projectId}`,
      method: 'DELETE',
    },
    projectId,
    'flushing.mongo.project',
    callback
  )
}

function flushDocToMongo(projectId, docId, callback) {
  _makeRequest(
    {
      path: `/project/${projectId}/doc/${docId}/flush`,
      method: 'POST',
    },
    projectId,
    'flushing.mongo.doc',
    callback
  )
}

function deleteDoc(projectId, docId, callback) {
  _makeRequest(
    {
      path: `/project/${projectId}/doc/${docId}`,
      method: 'DELETE',
    },
    projectId,
    'delete.mongo.doc',
    callback
  )
}

function getDocument(projectId, docId, fromVersion, callback) {
  _makeRequest(
    {
      path: `/project/${projectId}/doc/${docId}?fromVersion=${fromVersion}`,
      json: true,
    },
    projectId,
    'get-document',
    function (error, doc) {
      if (error) {
        return callback(error)
      }
      callback(null, doc.lines, doc.version, doc.ranges, doc.ops)
    }
  )
}

function setDocument(projectId, docId, userId, docLines, source, callback) {
  _makeRequest(
    {
      path: `/project/${projectId}/doc/${docId}`,
      method: 'POST',
      json: {
        lines: docLines,
        source,
        user_id: userId,
      },
    },
    projectId,
    'set-document',
    callback
  )
}

function getProjectDocsIfMatch(projectId, projectStateHash, callback) {
  // If the project state hasn't changed, we can get all the latest
  // docs from redis via the docupdater. Otherwise we will need to
  // fall back to getting them from mongo.
  const timer = new metrics.Timer('get-project-docs')
  const url = `${settings.apis.documentupdater.url}/project/${projectId}/get_and_flush_if_old?state=${projectStateHash}`
  request.post(url, function (error, res, body) {
    timer.done()
    if (error) {
      OError.tag(error, 'error getting project docs from doc updater', {
        url,
        projectId,
      })
      return callback(error)
    }
    if (res.statusCode === 409) {
      // HTTP response code "409 Conflict"
      // Docupdater has checked the projectStateHash and found that
      // it has changed. This means that the docs currently in redis
      // aren't the only change to the project and the full set of
      // docs/files should be retreived from docstore/filestore
      // instead.
      callback()
    } else if (res.statusCode >= 200 && res.statusCode < 300) {
      let docs
      try {
        docs = JSON.parse(body)
      } catch (error1) {
        return callback(OError.tag(error1))
      }
      callback(null, docs)
    } else {
      callback(
        new OError(
          `doc updater returned a non-success status code: ${res.statusCode}`,
          {
            projectId,
            url,
          }
        )
      )
    }
  })
}

function clearProjectState(projectId, callback) {
  _makeRequest(
    {
      path: `/project/${projectId}/clearState`,
      method: 'POST',
    },
    projectId,
    'clear-project-state',
    callback
  )
}

function acceptChanges(projectId, docId, changeIds, callback) {
  _makeRequest(
    {
      path: `/project/${projectId}/doc/${docId}/change/accept`,
      json: { change_ids: changeIds },
      method: 'POST',
    },
    projectId,
    'accept-changes',
    callback
  )
}

function deleteThread(projectId, docId, threadId, callback) {
  _makeRequest(
    {
      path: `/project/${projectId}/doc/${docId}/comment/${threadId}`,
      method: 'DELETE',
    },
    projectId,
    'delete-thread',
    callback
  )
}

function resyncProjectHistory(
  projectId,
  projectHistoryId,
  docs,
  files,
  callback
) {
  _makeRequest(
    {
      path: `/project/${projectId}/history/resync`,
      json: { docs, files, projectHistoryId },
      method: 'POST',
    },
    projectId,
    'resync-project-history',
    callback
  )
}

function updateProjectStructure(
  projectId,
  projectHistoryId,
  userId,
  changes,
  callback
) {
  if (
    settings.apis.project_history == null ||
    !settings.apis.project_history.sendProjectStructureOps
  ) {
    return callback()
  }

  const {
    deletes: docDeletes,
    adds: docAdds,
    renames: docRenames,
  } = _getUpdates('doc', changes.oldDocs, changes.newDocs)
  const {
    deletes: fileDeletes,
    adds: fileAdds,
    renames: fileRenames,
  } = _getUpdates('file', changes.oldFiles, changes.newFiles)
  const updates = [].concat(
    docDeletes,
    fileDeletes,
    docAdds,
    fileAdds,
    docRenames,
    fileRenames
  )
  const projectVersion =
    changes && changes.newProject && changes.newProject.version

  if (updates.length < 1) {
    return callback()
  }

  if (projectVersion == null) {
    logger.warn(
      { projectId, changes, projectVersion },
      'did not receive project version in changes'
    )
    return callback(new Error('did not receive project version in changes'))
  }

  _makeRequest(
    {
      path: `/project/${projectId}`,
      json: {
        updates,
        userId,
        version: projectVersion,
        projectHistoryId,
      },
      method: 'POST',
    },
    projectId,
    'update-project-structure',
    callback
  )
}

function _makeRequest(options, projectId, metricsKey, callback) {
  const timer = new metrics.Timer(metricsKey)
  request(
    {
      url: `${settings.apis.documentupdater.url}${options.path}`,
      json: options.json,
      method: options.method || 'GET',
    },
    function (error, res, body) {
      timer.done()
      if (error) {
        logger.warn(
          { error, projectId },
          'error making request to document updater'
        )
        callback(error)
      } else if (res.statusCode >= 200 && res.statusCode < 300) {
        callback(null, body)
      } else {
        error = new Error(
          `document updater returned a failure status code: ${res.statusCode}`
        )
        logger.warn(
          { error, projectId },
          `document updater returned failure status code: ${res.statusCode}`
        )
        callback(error)
      }
    }
  )
}

function _getUpdates(entityType, oldEntities, newEntities) {
  if (!oldEntities) {
    oldEntities = []
  }
  if (!newEntities) {
    newEntities = []
  }
  const deletes = []
  const adds = []
  const renames = []

  const oldEntitiesHash = _.indexBy(oldEntities, entity =>
    entity[entityType]._id.toString()
  )
  const newEntitiesHash = _.indexBy(newEntities, entity =>
    entity[entityType]._id.toString()
  )

  // Send deletes before adds (and renames) to keep a 1:1 mapping between
  // paths and ids
  //
  // When a file is replaced, we first delete the old file and then add the
  // new file. If the 'add' operation is sent to project history before the
  // 'delete' then we would have two files with the same path at that point
  // in time.
  for (const id in oldEntitiesHash) {
    const oldEntity = oldEntitiesHash[id]
    const newEntity = newEntitiesHash[id]

    if (newEntity == null) {
      // entity deleted
      deletes.push({
        type: `rename-${entityType}`,
        id,
        pathname: oldEntity.path,
        newPathname: '',
      })
    }
  }

  for (const id in newEntitiesHash) {
    const newEntity = newEntitiesHash[id]
    const oldEntity = oldEntitiesHash[id]

    if (oldEntity == null) {
      // entity added
      adds.push({
        type: `add-${entityType}`,
        id,
        pathname: newEntity.path,
        docLines: newEntity.docLines,
        url: newEntity.url,
        hash: newEntity.file != null ? newEntity.file.hash : undefined,
      })
    } else if (newEntity.path !== oldEntity.path) {
      // entity renamed
      renames.push({
        type: `rename-${entityType}`,
        id,
        pathname: oldEntity.path,
        newPathname: newEntity.path,
      })
    }
  }

  return { deletes, adds, renames }
}
