#!/usr/bin/env node
// 把 layout 與 mod 裝進 herdr App：node install.mjs [--switch] [--folders] [--force]
// - mods/quota-status、mods/herdr-folders 每次都更新（使用者自己的 config.json 不動）
// - layouts/quota-main.json、quota-folders.json 已經有的話不蓋掉（可能改過），--force 才覆蓋，舊的留成 .bak-<時間>
// - 沒裝 tendr 的看板（mods/tendr-board）就把 layout 裡的 tendr 區塊拿掉；之後裝了 tendr，
//   用 tendr 的 `node app/install.mjs --layout quota-main` 加回來
// - --switch：herdr-app check 後切到 quota-main（App 要開著），加 --folders 改切到有資料夾側欄的 quota-folders
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appHome = process.env.HERDR_APP_HOME || path.join(os.homedir(), '.config', 'herdr-app')
const args = process.argv.slice(2)
const LAYOUTS = ['quota-main', 'quota-folders']
const MODS = ['quota-status', 'herdr-folders']
const SHOWN = args.includes('--folders') ? 'quota-folders' : 'quota-main'

if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error('需要 Node.js 18 以上（quota.mjs 用到內建的 fetch）')
  process.exit(1)
}
if (!fs.existsSync(appHome)) {
  console.error('找不到 herdr App 的資料夾：' + appHome + '（先裝好並開過一次 herdr App）')
  process.exit(1)
}

// mod：整個資料夾複製過去，覆蓋同名檔案但不刪別的（config.json 留著）。mod.json 要先到：
// App 開著時，新 mod 的 main.js 先到的話，會照預設塞一塊進目前顯示的 layout
const modTargets = MODS.map((mod) => {
  const source = path.join(here, 'mods', mod)
  const target = path.join(appHome, 'mods', mod)
  fs.mkdirSync(target, { recursive: true })
  const names = fs.readdirSync(source).sort((a, b) => (b === 'mod.json') - (a === 'mod.json'))
  for (const name of names) fs.copyFileSync(path.join(source, name), path.join(target, name))
  console.log('已安裝 mod：' + target)
  return target
})

// layout
const find = (node, id) => {
  if (node?.id === id) return node
  for (const child of node?.children ?? []) {
    const found = find(child, id)
    if (found) return found
  }
  return null
}
for (const name of LAYOUTS) {
  const layoutTarget = path.join(appHome, 'layouts', name + '.json')
  if (fs.existsSync(layoutTarget) && !args.includes('--force')) {
    console.log('已經有 ' + layoutTarget + '，不覆蓋（要用新版就加 --force，舊的會留備份）')
    continue
  }
  if (fs.existsSync(layoutTarget)) {
    const backup = layoutTarget + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(layoutTarget, backup)
    console.log('舊的 layout 備份在 ' + backup)
  }
  const layout = JSON.parse(fs.readFileSync(path.join(here, 'layouts', name + '.json'), 'utf8'))
  if (!fs.existsSync(path.join(appHome, 'mods', 'tendr-board'))) {
    const stack = find(layout, 'panel-body')
    if (stack) stack.children = stack.children.filter((c) => c.id !== 'tendr')
    console.log('沒裝 tendr 的看板，layout 裡的 tendr 區塊先拿掉（裝 tendr 後用它的 app/install.mjs --layout ' + name + ' 加回來）')
  }
  fs.mkdirSync(path.dirname(layoutTarget), { recursive: true })
  fs.writeFileSync(layoutTarget, JSON.stringify(layout, null, 2) + '\n')
  console.log('已安裝 layout：' + layoutTarget)
}

if (args.includes('--switch')) {
  const run = (cmdArgs) => execFileSync('herdr-app', cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    for (const target of modTargets) console.log(run(['check', target]))
    console.log(run(['do', 'layout.switch', JSON.stringify({ name: SHOWN })]))
    console.log('已切到 ' + SHOWN + '（Ctrl+Shift+L 可以切回原本的 layout）')
  } catch (err) {
    console.error('切換失敗（herdr App 要開著、herdr-app 要在 PATH 上）：' + String(err.stderr || err.message).trim())
    process.exit(1)
  }
}
