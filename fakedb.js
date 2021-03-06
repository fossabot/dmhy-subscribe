const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')
const path = require('path')
const { hash, XSet } = require('./utils')
const { version } = require('./package.json')
const { Config } = require('./config')

require('console.table')

class Subscription {
  constructor (subscribable) {
    if (typeof subscribable === 'string') {
      [this.name, ...this.keywords] = subscribable.split(',')
      this.keywords.sort()
      this.sid = null
      this.threads = []
      this.latest = -1 // last episode of threads
    } else if (typeof subscribable === 'object') {
      Object.assign(this, subscribable)
    }
  }

  sort () {
    this.threads.sort((a, b) => b.ep[0] - a.ep[0]) // latest to earliest
  }

  add (thread) {
    if (thread.ep.every(isFinite) && thread.title && thread.link) {
      this.threads.push(thread)
      this.sort()
      this.latest = this.threads[0].ep.slice(-1)[0]
    } else {
      console.error(`Can't add invalid thread into subscription [${this.name}]`, thread)
    }
  }

  generateSid (existedSids = []) {
    const existed = new Set(existedSids)
    this.sid = hash(this.name, this.keywords.join(','))
    while (existed.has(this.sid)) {
      this.sid = hash(this.name, this.sid)
    }
  }

  list () {
    const subscribable = [this.name, ...this.keywords].join(',')
    console.log(subscribable)
    console.log('='.repeat(subscribable.length))
    console.log()
    const threads = this.threads.map(th => {
      return {
        Episode: th.ep.join(','),
        Title: th.title
      }
    })
    console.table(threads.slice().reverse())
  }

  getThreads (epstr) {
    if (!epstr || epstr === 'all') {
      return this.threads
    }

    const collection = new XSet()
    const eps = epstr.split(',')
    for (const ep of eps) {
      if (isFinite(Number(ep))) {
        collection.union(this.threads.filter(th => th.ep.includes(Number(ep))), true)
      } else {
        const [epi, epj] = ep
          .split(/\.{2,}/)
          .map(Number)
          .sort()
        // this.threads := [latest ... earliest]
        const head = this.threads.findIndex(th => th.ep.includes(epj))
        const tail = this.threads.findIndex(th => th.ep.includes(epi))
        collection.union(this.threads.slice(head, tail + 1), true)
      }
    }
    return [...collection]
  }
}

class Database {
  constructor ({ dbFile, config } = { dbFile: `${os.homedir()}/.dmhy-subscribe/fakedb.json`, config: new Config() }) {
    this.fakedbPath = dbFile
    this.config = config

    if (!fs.existsSync(this.fakedbPath)) {
      const empty = {
        version,
        subscriptions: []
      }
      fs.writeFileSync(this.fakedbPath, JSON.stringify(empty))
    }

    const fakedb = JSON.parse(fs.readFileSync(this.fakedbPath, 'utf8'))
    this.subscriptions = fakedb.subscriptions.map(s => new Subscription(s))
    this.version = version
  }

  add (subscription) {
    if (subscription.constructor.name !== 'Subscription') {
      throw new TypeError('Parameter should be a Subscription.')
    }
    subscription.generateSid(this.subscriptions.map(s => s.sid))
    this.subscriptions.push(subscription)
    console.log(`Add subscription{${subscription.name}} successfully.`)
  }

  remove (subscription) {
    if (subscription.constructor.name !== 'Subscription') {
      throw new TypeError('Parameter should be a Subscription.')
    }
    const index = this.subscriptions.findIndex(elem => {
      return elem.sid === subscription.sid
    })
    if (index >= 0) {
      this.subscriptions.splice(index, 1)
      console.log(`Remove subscription{${subscription.name}} successfully.`)
    }
  }

  save () {
    const sav = {
      version: this.version,
      subscriptions: this.subscriptions
    }
    fs.writeFileSync(this.fakedbPath, JSON.stringify(sav))
  }

  list () {
    const subList = this.subscriptions.map(s => {
      const latest = s.latest > 0 ? s.latest.toString().padStart(2, '0') : '--'
      return {
        sid: s.sid,
        latest,
        name: s.name
      }
    })
    console.table(subList)
  }

  download (thread, { client, destination, jsonrpc } = {}) {
    const dest = destination || this.config.get('destination')
    const dclient = client || this.config.get('client')
    const djsonrpc = jsonrpc || this.config.get('jsonrpc')

    const script = path.resolve(`${__dirname}/downloaders/${dclient}.js`)
    const args = [thread, { dest, jsonrpc: djsonrpc }].map(JSON.stringify)
    args.unshift(script)

    return new Promise((resolve, reject) => {
      const task = spawn('node', args, {
        stdio: 'inherit'
      })
      task.on('close', code => {
        if (code === 0) resolve(code)
        else reject(code)
      })
      task.on('error', err => reject(err))
    })
  }

  has (key, value) {
    const results = this.subscriptions.filter(s => s[key] === value)
    return !!results.length
  }

  query (key, value) {
    const results = this.subscriptions.filter(s => s[key] === value)
    return results[0] || null
  }

  sort () {
    this.subscriptions.forEach(s => s.sort())
    this.subscriptions.sort((a, b) => b.latest - a.latest)
  }

  static isSupportedClient (client) {
    return (new Set(['aria2', 'deluge'])).has(client)
  }
}

module.exports = {
  Subscription,
  Database
}
