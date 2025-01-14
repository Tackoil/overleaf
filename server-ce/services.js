module.exports = [
  {
    name: 'web',
    repo: 'https://github.com/sharelatex/web-sharelatex.git',
    version: 'master',
  },
  {
    name: 'real-time',
    repo: 'https://github.com/sharelatex/real-time-sharelatex.git',
    version: 'master',
  },
  {
    name: 'document-updater',
    repo: 'https://github.com/sharelatex/document-updater-sharelatex.git',
    version: 'master',
  },
  {
    name: 'clsi',
    repo: 'https://github.com/sharelatex/clsi-sharelatex.git',
    version: 'master',
  },
  {
    name: 'filestore',
    repo: 'https://github.com/sharelatex/filestore-sharelatex.git',
    version: 'master',
  },
  {
    name: 'track-changes',
    repo: 'https://github.com/sharelatex/track-changes-sharelatex.git',
    version: 'master',
  },
  {
    name: 'docstore',
    repo: 'https://github.com/sharelatex/docstore-sharelatex.git',
    version: 'master',
  },
  {
    name: 'chat',
    repo: 'https://github.com/sharelatex/chat-sharelatex.git',
    version: 'master',
  },
  {
    name: 'spelling',
    repo: 'https://github.com/sharelatex/spelling-sharelatex.git',
    version: 'master',
  },
  {
    name: 'references',
    version: 'master',
  },
  {
    name: 'contacts',
    repo: 'https://github.com/sharelatex/contacts-sharelatex.git',
    version: 'master',
  },
  {
    name: 'notifications',
    repo: 'https://github.com/sharelatex/notifications-sharelatex.git',
    version: 'master',
  },
]

if (require.main === module) {
  for (const service of module.exports) {
    console.log(service.name)
  }
}
