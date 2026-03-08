import fs from 'node:fs/promises'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ALLOWED_PREFIX = new Set([
    'FEAT','FEATURE',
    'FIX','PATCH',
    'REFACTOR',
    'PERF',
    'DOCS',
    'TEST',
    'BUILD',
    'CI',
    'CHORE',
    'VERSION',
    'UPDATE',
    'MAJOR','BREAKING'
])

function git(repo, args) {
    return execSync(`git ${args}`, { cwd: repo, encoding: 'utf8' })
}

function parseCommit(subject, body) {

    const mBracket = /^\[(?<tag>[A-Za-z-]+)]\s*(?<desc>.+)$/.exec(subject)
    if (mBracket) {
        const tag = mBracket.groups.tag.toUpperCase()
        if (!ALLOWED_PREFIX.has(tag)) return null
        return { tag, desc: mBracket.groups.desc }
    }

    const mConv = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?!?:\s*(?<desc>.+)$/.exec(subject)

    if (mConv) {
        const tag = mConv.groups.type.toUpperCase()
        if (!ALLOWED_PREFIX.has(tag)) return null
        return { tag, desc: mConv.groups.desc }
    }

    return null
}

function getCommits(repo, range) {

    const out = git(repo, `log ${range} --no-merges --pretty=format:%H%x1f%s%x1f%b%x1e`)
    const rows = out.split('\x1e').filter(Boolean)

    return rows.map(r=>{
        const [hash,subject,body] = r.split('\x1f')
        return { hash, subject, body }
    })
}

function getTags(repo) {

    const raw = git(repo,'tag --list')
    if (!raw.trim()) return []

    return raw
        .split('\n')
        .map(t=>t.trim())
        .filter(Boolean)
}

export async function generateChangelog({ repoRoot }) {

    const tags = getTags(repoRoot)

    const sections = []

    if (tags.length) {

        const latest = tags[tags.length-1]

        sections.push({
            name:'Unreleased',
            commits:getCommits(repoRoot,`${latest}..HEAD`)
        })

        for (let i=tags.length-1;i>=0;i--) {

            const cur = tags[i]
            const prev = tags[i-1]

            const range = prev ? `${prev}..${cur}` : cur

            sections.push({
                name:cur,
                commits:getCommits(repoRoot,range)
            })
        }

    } else {

        sections.push({
            name:'Unreleased',
            commits:getCommits(repoRoot,'HEAD')
        })

    }

    let md = '# Changelog\n\n'

    for (const sec of sections) {

        md += `## ${sec.name}\n\n`

        const lines = []

        for (const c of sec.commits) {

            const p = parseCommit(c.subject,c.body)
            if (!p) continue

            lines.push(`- [${p.tag}] ${p.desc} (${c.hash.slice(0,7)})`)
        }

        md += lines.length
            ? lines.join('\n') + '\n\n'
            : '_nessuna modifica_\n\n'
    }

    return md
}

export async function writeChangelog({ repoRoot, output }) {

    const md = await generateChangelog({ repoRoot })

    await fs.writeFile(
        path.join(repoRoot, output ?? 'CHANGELOG.md'),
        md,
        'utf8'
    )
}