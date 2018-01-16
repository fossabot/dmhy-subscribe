#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const axios = require('axios')
const cheerio = require('cheerio')
const program = require('commander')
const spawn = require('child_process').spawn
const pkg = require('./package.json')

const CWD = process.cwd()
// Make cwd to source
process.chdir(__dirname)

if (!fs.existsSync('fakedb.json')) {
  fs.writeFileSync('fakedb.json', '[]')
}

class Database {
  constructor (db) {
    this.db = db
    this.maxAnimeLength = 0
    for (const anime of this.db) {
      this.maxAnimeLength = Math.max(this.maxAnimeLength, anime.name.length)
    }
  }

  * [Symbol.iterator] () {
    for (const anime of this.db) {
      yield anime
    }
  }

  push (anime) {
    if (anime) {
      this.db.push(anime)
    }
  }
  pop (anime) {
    const index = this.db.findIndex(elem => {
      return elem.vid === anime.vid
    })
    if (index >= 0) {
      this.db.splice(index, 1)
    }
  }
  save () {
    fs.writeFileSync('fakedb.json', JSON.stringify(this.db))
  }
  list () {
    console.log(`vid | latest | name`)
    console.log()
    for (const anime of this.db) {
      const lastEpisode = anime.episodes[0]
      const latest = (lastEpisode ? lastEpisode.ep : '--').toString().padStart(2, '0')
      console.log(`${anime.vid} |   ${latest}   | ${anime.name}`)
    }
  }
  query (key, val) {
    function parseEpkey (episodes, epkey) {
      if (epkey.includes('all')) {
        return 'all'
      } else if (epkey.includes(',')) {
        return epkey.split(/,\s*/)
          .map(epk => parseEpkey(episodes, epk))
          .reduce((acc, val) => val >= 0 ? acc.concat(val) : acc, [])
      } else if (epkey.includes('..')) {
        let [p, q] = epkey.split('..')
        p = parseFloat(p)
        q = parseFloat(q)
        if (p > q) {
          [p, q] = [q, p]
        }

        const P = episodes.findIndex(ep => ep.ep >= p)
        let Q = episodes.findIndex(ep => ep.ep > q)
        Q = Q < 0 ? episodes.length : Q + 1

        return episodes.slice(P, Q).map(ep => ep.ep)
      } else if (epkey.match(/\d+\.?\d*/)) {
        return parseFloat(epkey)
      } else {
        console.error('parseEpkey: Unknown epkey: ', epkey)
        return undefined
      }
    }

    switch (key) {
      case 'vid':
      case 'name':
        return this.db.find(anime => anime[key] === val) || null

      case 'epid': {
        const [vid, epkey] = val.split('-')
        const anime = this.db.find(anime => anime.vid === vid)
        if (!anime) {
          return null
        }
        const eps = parseEpkey(anime.episodes, epkey)
        if (eps === 'all') {
          return anime.episodes
        } else {
          return anime.episodes.filter(ep => [].concat(eps).includes(ep.ep))
        }
      }

      default:
        return null
    }
  }
  download (episode) {
    const task = spawn('deluge-console', ['add', episode.link])

    task.on('close', (code) => {
      if (code === 0) {
        console.log(`Add ${episode.title}`)
      } else {
        console.error(`Fail to add ${episode.title}`)
      }
    })
  }
  createAnime (str) {
    const [name, ...keywords] = str.split(',')
    return {
      vid: this.generateVid(name),
      name,
      keywords,
      episodes: []
    }
  }
  generateVid (name) {
    const hash = Buffer.from(name).toString('base64')
      .replace(/[\W\d]/g, '')
      .toUpperCase()
      .split('')
      .reverse()
      .join('')

    for (let offset = 0; offset <= hash.length - 3; offset++) {
      const vid = hash.slice(offset).slice(0, 3)
      if (vid.length === 3 && !this.query('vid', vid)) {
        return vid
      }
    }

    return this.generateVid(name + hash)
  }
}

const fakedb = JSON.parse(fs.readFileSync('fakedb.json'))
const db = new Database(fakedb)

program
  .version(pkg.version)

program
  .command('add [anime...]')
  .option('-f, --file <path>', 'Add from file.')
  .description(`
  Add <anime> to subscribe.

  A <anime> contains a name and following keywords
  to identify series you want to download, then
  joins them by CSV format in a string.

  Examples:

    Direct:
      $ dmhy add '紫羅蘭永恆花園,動漫國,繁體,1080P'
      $ dmhy add '紫羅蘭永恆花園,動漫國,繁體,1080P' 'pop team epic,極影,BIG5'

    File:
      $ dmhy ls -addable > a.txt
      $ dmhy rm --all
      $ dmhy add --file a.txt
  `)
  .action(function (animes, cmd) {
    if (!animes.length && !cmd.file) {
      this.help()
    } else {
      if (cmd.file) {
        const file = fs.readFileSync(path.normalize(path.join(CWD, cmd.file)), 'utf8')
        for (const a of file.split(/\r?\n/)) {
          if (a) {
            animes.push(a)
          }
        }
      }

      for (const a of animes) {
        const anime = db.createAnime(a)
        if (!db.query('name', anime.name)) {
          db.push(anime)
          console.log(`Add ${anime.name} successfully.`)
        } else {
          console.error(`Anime ${anime.name} has existed.`)
        }
      }
      db.save()
      process.exit()
    }
  })

program
  .command('remove [vid...]')
  .alias('rm')
  .option('-a, --all', 'Remove all subscribed <anime>.')
  .description(`
  Unsubscribe <anime> by <vid>.

  The <vid> are listed at \`$ dmhy list\`.

  Examples:
    $ dmhy rm XYZ ABC
    $ dmhy rm -a
  `)
  .action(function (vids, cmd) {
    if (!vids.length && !cmd.all) {
      this.help()
    } else {
      if (cmd.all) {
        vids = [...db].map(anime => anime.vid)
      }

      for (const vid of vids) {
        const anime = db.query('vid', vid)
        if (anime) {
          console.log('Remove', anime.name)
          db.pop(anime)
        } else {
          console.error(`Not found vid: ${vid}.`)
        }
      }
      db.save()
      process.exit()
    }
  })

program
  .command('download [epid...]')
  .alias('dl')
  .usage('[epid...]')
  .description(`
  Download <episode> of <anime> which are subscribed.

  The epid format: <vid>-<ep>
  <ep> : int | float | 'all' | <ep>..<ep> | <ep>,<ep>

  Examples:
    $ dmhy download ABC-01
    $ dmhy dl XYZ-5.5 QWE-all ZZZ-1,3..5,6,8
  `)
  .action(function (epids) {
    if (!epids.length) {
      this.help()
    } else {
      for (const epid of epids) {
        for (const episode of db.query('epid', epid)) {
          db.download(episode)
        }
      }
    }
    process.exit()
  })

program
  .command('list')
  .alias('ls')
  .option('-a, --addable', 'List addable format.')
  .description(`
  List all <anime> which are subscribed.
  `)
  .action(function (cmd) {
    if (cmd.addable) {
      for (const anime of db) {
        console.log([anime.name, ...anime.keywords].join())
      }
    } else {
      db.list()
    }

    process.exit()
  })

program.parse(process.argv)

for (const anime of db) {
  const kw = [anime.name, ...anime.keywords].join('+')

  axios.get(encodeURI(`https://share.dmhy.org/topics/list?keyword=${kw}`))
    .then(response => {
      if (response.status !== 200) {
        throw new Error(response)
      }
      const $ = cheerio.load(response.data)
      const titleTexts = $('#topic_list tr:nth-child(n+1) .title > a').text()
      const titles = titleTexts.split(/[\n\t]+/).filter(x => x)

      const magnetElement = $('#topic_list tr:nth-child(n+1) a.download-arrow').toArray()
      const magnets = magnetElement.map(x => x.attribs.href)

      if (titles.length !== magnets.length) {
        throw new Error('titles.length !== magnets.length')
      }

      const dmhyEpisodes = titles.map((t, i) => {
        return {
          title: t,
          link: magnets[i],
          ep: parseFloat(t.replace(/.*\[(\d\.?\d?)(v\d*)?\].*/, '$1'))
        }
      })

      if (dmhyEpisodes.length !== anime.episodes.length) {
        for (const dep of dmhyEpisodes) {
          const existed = anime.episodes.find(x => x.ep === dep.ep)
          if (!existed) {
            db.download(dep)
            anime.episodes.push(dep)
          }
        }
      }

      db.save()
    })
    .catch(error => {
      console.error(error)
    })
}