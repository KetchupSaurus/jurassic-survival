const canvas = document.getElementById('gameCanvas')
const ctx = canvas.getContext('2d')

// Fill the whole screen
canvas.width  = window.innerWidth
canvas.height = window.innerHeight
window.addEventListener('resize', () => {
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight
})

// ─── Constants ────────────────────────────────────────────────────────────────

const DINO_STAGES = [
  { name: 'Gallimimus', applesNeeded: 0,  size: 30, speed: 4,   color: '#90EE90', canKill: [],                                            dinoType: 'galli'  },
  { name: 'Utah Raptor', applesNeeded: 3,  size: 40, speed: 5,   color: '#FFD700', canKill: ['small'],                                     dinoType: 'raptor' },
  { name: 'T-Rex',       applesNeeded: 10, size: 55, speed: 4,   color: '#FF6347', canKill: ['small', 'trex', 'nano', 'ankylo'],           dinoType: 'trex'   },
  { name: 'Spinosaurus', applesNeeded: 15, size: 70, speed: 3,   color: '#9370DB', canKill: ['small', 'trex', 'spino', 'nano', 'ankylo'], dinoType: 'spino'  },
]

// ─── Enemy config table ────────────────────────────────────────────────────────
const ENEMY_PROPS = {
  trex:  { size: 50,  baseSpeed: 2.0, color: '#DC143C', label: 'T-Rex'  },
  spino: { size: 65,  baseSpeed: 1.5, color: '#1E90FF', label: 'Spino'  },
  nano:  { size: 48,  baseSpeed: 2.3, color: '#7ec8e3', label: 'Nano-T' },
  ankylo:{ size: 62,  baseSpeed: 1.4, color: '#c89a46', label: 'Ankylo' },
}

// Biome zones (left third = snow, middle = forest, right third = desert)
function getBiome(x) {
  if (x < canvas.width / 3)   return 'snow'
  if (x > canvas.width * 2/3) return 'desert'
  return 'forest'
}

const TAR_COUNT      = 8    // how many tar pits on the map
const TAR_SLOW       = 0.4  // multiplier when in tar (lower = slower)
const ATTACK_RANGE   = 120  // pixels — how close you need to be to attack
const HIT_COOLDOWN   = 90   // frames between hits player can receive (~1.5s at 60fps)
const ENEMY_HIT_COOLDOWN = 60 // frames between an enemy's hits on player

// ─── State ────────────────────────────────────────────────────────────────────

let player, enemies, apples, tarPits, trees
let boss, bossSpawned, bossAnnounce
let boss2, boss2Spawned, boss2Announce
let boss3, boss3Spawned, boss3Announce, boss3Projectiles
let shieldPickup, score, gameRunning, animFrame
let spaceJustPressed    = false
let twoPlayerMode       = false
let player2             = null

// ─── Input (keyboard — kept for dev/desktop testing) ─────────────────────────

const keys = {}
document.addEventListener('keydown', e => {
  if (e.key === ' ' && !keys[' ']) spaceJustPressed = true
  keys[e.key] = true
  if (e.key === 'r' || e.key === 'R') {
    if (!gameRunning) restartGame()
  }
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault()
  }
})
document.addEventListener('keyup', e => { keys[e.key] = false })

// ─── Gamepad ──────────────────────────────────────────────────────────────────

let gamepadIndex  = -1
let gpPrevAttack  = false
let gpPrevStart   = false
let gpConnected   = false  // true when any controller is live

window.addEventListener('gamepadconnected', e => {
  gamepadIndex = e.gamepad.index
  gpConnected  = true
  console.log(`Controller connected: ${e.gamepad.id}`)
})
window.addEventListener('gamepaddisconnected', e => {
  if (e.gamepad.index === gamepadIndex) {
    gamepadIndex = -1
    gpConnected  = false
  }
})

// Standard Gamepad API button layout (matches PS5 DualSense & Xbox Series via Bluetooth/USB):
//   buttons[0]  = A / Cross       — primary confirm / jump
//   buttons[1]  = B / Circle
//   buttons[2]  = X / Square
//   buttons[3]  = Y / Triangle
//   buttons[4]  = LB / L1
//   buttons[5]  = RB / R1
//   buttons[6]  = LT / L2  (may be axis on some browsers)
//   buttons[7]  = RT / R2  (may be axis on some browsers)
//   buttons[8]  = Back / Share
//   buttons[9]  = Start / Options
//   buttons[10] = L3 (left stick click)
//   buttons[11] = R3 (right stick click)
//   buttons[12] = D-pad Up
//   buttons[13] = D-pad Down
//   buttons[14] = D-pad Left
//   buttons[15] = D-pad Right
//   axes[0,1]   = Left stick X/Y
//   axes[2,3]   = Right stick X/Y

function btn(gp, i) { return gp.buttons[i]?.pressed ?? false }

function pollGamepad() {
  if (gamepadIndex === -1) return null
  const gp = navigator.getGamepads()[gamepadIndex]
  if (!gp) return null

  const DEADZONE = 0.15
  let dx = 0, dy = 0

  // Left stick
  if (Math.abs(gp.axes[0]) > DEADZONE) dx = gp.axes[0]
  if (Math.abs(gp.axes[1]) > DEADZONE) dy = gp.axes[1]

  // Right stick also drives movement (useful for one-handed play)
  if (Math.abs(gp.axes[2] ?? 0) > DEADZONE) dx = gp.axes[2]
  if (Math.abs(gp.axes[3] ?? 0) > DEADZONE) dy = gp.axes[3]

  // D-pad
  if (btn(gp, 14)) dx = -1
  if (btn(gp, 15)) dx =  1
  if (btn(gp, 12)) dy = -1
  if (btn(gp, 13)) dy =  1

  // Attack: A/Cross, X/Square, R1/RB, R2/RT, L1/LB, L2/LT
  const attackNow = btn(gp, 0) || btn(gp, 2) || btn(gp, 4) || btn(gp, 5) || btn(gp, 6) || btn(gp, 7)
  if (attackNow && !gpPrevAttack) spaceJustPressed = true
  gpPrevAttack = attackNow

  // Start / Options — restart when game over
  const startNow = btn(gp, 9)
  if (startNow && !gpPrevStart && !gameRunning) restartGame()
  gpPrevStart = startNow

  return { dx, dy }
}

// ─── Touch Input ──────────────────────────────────────────────────────────────

const JOYSTICK_RADIUS       = 65
const JOYSTICK_THUMB_RADIUS = 30
const ATK_BTN_RADIUS        = 58

const joystick = {
  active:  false,
  touchId: null,
  baseX:   0,
  baseY:   0,
  thumbX:  0,
  thumbY:  0,
  dx:      0,
  dy:      0,
}

let atkBtnTouchId = null
let atkBtnActive  = false

// Returns the fixed on-screen positions for the two controls
function joyBase()   { return { x: 100,               y: canvas.height - 110 } }
function atkCenter() { return { x: canvas.width - 100, y: canvas.height - 110 } }

canvas.addEventListener('touchstart', e => {
  e.preventDefault()
  Array.from(e.changedTouches).forEach(t => {
    const atk = atkCenter()
    if (Math.hypot(t.clientX - atk.x, t.clientY - atk.y) < ATK_BTN_RADIUS * 1.6 && atkBtnTouchId === null) {
      atkBtnTouchId = t.identifier
      atkBtnActive  = true
    } else if (t.clientX < canvas.width * 0.6 && joystick.touchId === null) {
      joystick.touchId = t.identifier
      joystick.active  = true
      joystick.baseX   = t.clientX
      joystick.baseY   = t.clientY
      joystick.thumbX  = t.clientX
      joystick.thumbY  = t.clientY
      joystick.dx      = 0
      joystick.dy      = 0
    }
  })
}, { passive: false })

canvas.addEventListener('touchmove', e => {
  e.preventDefault()
  Array.from(e.changedTouches).forEach(t => {
    if (t.identifier !== joystick.touchId) return
    const rawDx = t.clientX - joystick.baseX
    const rawDy = t.clientY - joystick.baseY
    const mag   = Math.hypot(rawDx, rawDy)
    if (mag > JOYSTICK_RADIUS) {
      joystick.thumbX = joystick.baseX + (rawDx / mag) * JOYSTICK_RADIUS
      joystick.thumbY = joystick.baseY + (rawDy / mag) * JOYSTICK_RADIUS
      joystick.dx     = rawDx / mag
      joystick.dy     = rawDy / mag
    } else {
      joystick.thumbX = t.clientX
      joystick.thumbY = t.clientY
      joystick.dx     = mag > 5 ? rawDx / JOYSTICK_RADIUS : 0
      joystick.dy     = mag > 5 ? rawDy / JOYSTICK_RADIUS : 0
    }
  })
}, { passive: false })

function _endTouch(id) {
  if (id === joystick.touchId) {
    joystick.active  = false
    joystick.touchId = null
    joystick.dx      = 0
    joystick.dy      = 0
  }
  if (id === atkBtnTouchId) {
    atkBtnActive  = false
    atkBtnTouchId = null
  }
}

canvas.addEventListener('touchend',    e => { e.preventDefault(); Array.from(e.changedTouches).forEach(t => _endTouch(t.identifier)) }, { passive: false })
canvas.addEventListener('touchcancel', e => { e.preventDefault(); Array.from(e.changedTouches).forEach(t => _endTouch(t.identifier)) }, { passive: false })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNearestAlivePlayer(x, y) {
  const p1ok = player && player.alive
  const p2ok = twoPlayerMode && player2 && player2.alive
  if (!p1ok && !p2ok) return null
  if (!p1ok) return player2
  if (!p2ok) return player
  const d1 = Math.hypot((player.x + player.size / 2) - x, (player.y + player.size / 2) - y)
  const d2 = Math.hypot((player2.x + player2.size / 2) - x, (player2.y + player2.size / 2) - y)
  return d1 <= d2 ? player : player2
}

function damagePlayer(p) {
  if (!p || !p.alive || p.hitCooldown > 0) return
  p.hp--
  p.hitCooldown = HIT_COOLDOWN
  p.invincible  = HIT_COOLDOWN
  updateUI()
  if (p.hp <= 0) {
    p.hp    = 0
    p.alive = false
    const p1dead = !player.alive
    const p2dead = !twoPlayerMode || !player2 || !player2.alive
    if (p1dead && p2dead) endGame()
  }
}

function damagePlayerUnshielded(p) {
  if (!p || !p.alive || p.hitCooldown > 0 || p.shieldTimer > 0) return
  p.hp--
  p.hitCooldown = HIT_COOLDOWN
  p.invincible  = HIT_COOLDOWN
  updateUI()
  if (p.hp <= 0) {
    p.hp    = 0
    p.alive = false
    const p1dead = !player.alive
    const p2dead = !twoPlayerMode || !player2 || !player2.alive
    if (p1dead && p2dead) endGame()
  }
}

// ─── Start / Restart ─────────────────────────────────────────────────────────

function startGame(twoPlayer = false) {
  twoPlayerMode = twoPlayer
  document.getElementById('start-screen').classList.add('hidden')
  document.getElementById('game-over').classList.add('hidden')

  player = {
    x: canvas.width  / 2,
    y: canvas.height / 2,
    stage: 0,
    baseSpeed: DINO_STAGES[0].speed,
    speed: DINO_STAGES[0].speed,
    size:  DINO_STAGES[0].size,
    dx: 0,
    dy: 0,
    invincible: 0,
    hp: 3,
    hitCooldown: 0,
    inTar: false,
    applesEaten: 0,
    shieldTimer: 0,
    alive: true,
    facing: 1,
  }

  player2 = null

  enemies          = []
  apples           = []
  tarPits          = []
  trees            = []
  boss             = null
  bossSpawned      = false
  bossAnnounce     = 0
  boss2            = null
  boss2Spawned     = false
  boss2Announce    = 0
  boss3            = null
  boss3Spawned     = false
  boss3Announce    = 0
  boss3Projectiles = []
  shieldPickup     = null
  score            = 0
  gameRunning      = true

  spawnTrees()
  spawnTarPits()
  spawnApples()
  spawnEnemies()
  updateUI()
  gameLoop()
}

function restartGame() {
  cancelAnimationFrame(animFrame)
  startGame(twoPlayerMode)
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

function gameLoop() {
  if (!gameRunning) return
  // ATK button held — fire attack this frame
  if (atkBtnActive) spaceJustPressed = true
  update()
  draw()
  spaceJustPressed    = false
  animFrame = requestAnimationFrame(gameLoop)
}

// ─── Update ───────────────────────────────────────────────────────────────────

function update() {

  // === PLAYER 1 ===
  if (player.alive) {
    player.inTar = tarPits.some(t => {
      const dx = (player.x + player.size / 2) - t.x
      const dy = (player.y + player.size / 2) - t.y
      return Math.hypot(dx, dy) < t.r
    })
    player.speed = player.inTar ? player.baseSpeed * TAR_SLOW : player.baseSpeed

    player.dx = 0
    player.dy = 0

    // Keyboard input
    if (keys['ArrowLeft'])  player.dx = -player.speed
    if (keys['ArrowRight']) player.dx =  player.speed
    if (keys['ArrowUp'])    player.dy = -player.speed
    if (keys['ArrowDown'])  player.dy =  player.speed
    if (keys['a']) player.dx = -player.speed
    if (keys['d']) player.dx =  player.speed
    if (keys['w']) player.dy = -player.speed
    if (keys['s']) player.dy =  player.speed

    // Gamepad input
    const gpInput = pollGamepad()
    if (gpInput && (gpInput.dx !== 0 || gpInput.dy !== 0)) {
      const mag = Math.hypot(gpInput.dx, gpInput.dy)
      player.dx = (gpInput.dx / mag) * player.speed
      player.dy = (gpInput.dy / mag) * player.speed
    }

    // Touch joystick — overrides keyboard/gamepad when active
    if (joystick.active && (joystick.dx !== 0 || joystick.dy !== 0)) {
      player.dx = joystick.dx * player.speed
      player.dy = joystick.dy * player.speed
    }

    player.x = Math.max(0, Math.min(canvas.width  - player.size, player.x + player.dx))
    player.y = Math.max(0, Math.min(canvas.height - player.size, player.y + player.dy))
    if (player.dx < 0) player.facing = -1
    else if (player.dx > 0) player.facing = 1

    if (player.invincible > 0)  player.invincible--
    if (player.hitCooldown > 0) player.hitCooldown--
    if (player.shieldTimer > 0) player.shieldTimer--
  }

  // === APPLE COLLECTION ===
  apples = apples.filter(a => {
    if (player.alive) {
      const dist = Math.hypot((player.x + player.size / 2) - a.x,
                              (player.y + player.size / 2) - a.y)
      if (dist < player.size / 2 + 12) {
        player.applesEaten++
        score += 10
        evolveCheck(player)
        updateUI()
        return false
      }
    }
    return true
  })

  if (apples.length < 8) spawnApples()

  // === SHIELD PICKUP ===
  if (shieldPickup) {
    if (player.alive) {
      const sdist = Math.hypot(
        (player.x + player.size / 2) - shieldPickup.x,
        (player.y + player.size / 2) - shieldPickup.y
      )
      if (sdist < player.size / 2 + 18) {
        player.shieldTimer = 25 * 60
        shieldPickup = null
      }
    }
  }

  // === ENEMY UPDATE ===
  enemies.forEach(e => {
    const enemyInTar = tarPits.some(t =>
      Math.hypot(e.x - t.x, e.y - t.y) < t.r
    )
    const eSpeed = enemyInTar ? e.baseSpeed * TAR_SLOW : e.baseSpeed

    const target = getNearestAlivePlayer(e.x, e.y)
    if (target) {
      const tx = target.x + target.size / 2
      const ty = target.y + target.size / 2

      const wandersAimlessly = (e.type === 'trex' || e.type === 'nano' || e.type === 'ankylo')
        && target.stage === DINO_STAGES.length - 1
      e.isWandering = wandersAimlessly

      if (wandersAimlessly) {
        if (e.wanderTimer <= 0) {
          e.wanderAngle = Math.random() * Math.PI * 2
          e.wanderTimer = 60 + Math.floor(Math.random() * 120)
        }
        e.wanderTimer--
        e.x += Math.cos(e.wanderAngle) * eSpeed
        e.y += Math.sin(e.wanderAngle) * eSpeed
        if (Math.cos(e.wanderAngle) < 0) e.facing = -1
        else e.facing = 1
      } else {
        const angle = Math.atan2(ty - e.y, tx - e.x)
        e.x += Math.cos(angle) * eSpeed
        e.y += Math.sin(angle) * eSpeed
        if (tx < e.x) e.facing = -1
        else if (tx > e.x) e.facing = 1
      }
    }

    e.x = Math.max(e.size / 2, Math.min(canvas.width  - e.size / 2, e.x))
    e.y = Math.max(e.size / 2, Math.min(canvas.height - e.size / 2, e.y))

    // ── P1 ATTACK / CONTACT ──────────────────────────────────────────────────
    if (player.alive) {
      const px    = player.x + player.size / 2
      const py    = player.y + player.size / 2
      const dist1 = Math.hypot(px - e.x, py - e.y)
      const stage1 = DINO_STAGES[player.stage]

      if (spaceJustPressed && dist1 < ATTACK_RANGE && stage1.canKill.includes(e.type)) {
        score += e.type === 'spino' ? 80 : 50
        e.dead = true
        updateUI()
        return
      }

      if (!e.dead && dist1 < player.size / 2 + e.size / 2) {
        if (stage1.canKill.includes(e.type) && e.type !== 'spino') {
          score += 20
          e.dead = true
          updateUI()
          return
        } else {
          damagePlayer(player)
        }
      }
    }

    if (e.hitCooldown > 0) e.hitCooldown--
  })

  enemies = enemies.filter(e => !e.dead)
  if (enemies.length < 4) spawnEnemies()

  // Boss check
  if (!bossSpawned && score >= 1000) {
    bossSpawned  = true
    bossAnnounce = 180
    spawnBoss()
  }
  if (bossAnnounce > 0) bossAnnounce--
  if (boss) updateBoss()

  if (!boss2Spawned && score >= 2000) {
    boss2Spawned  = true
    boss2Announce = 210
    spawnBoss2()
  }
  if (boss2Announce > 0) boss2Announce--
  if (boss2) updateBoss2()

  if (!boss3Spawned && score >= 3000) {
    boss3Spawned  = true
    boss3Announce = 210
    spawnBoss3()
  }
  if (boss3Announce > 0) boss3Announce--
  if (boss3) updateBoss3()
}

// ─── Evolve ───────────────────────────────────────────────────────────────────

function evolveCheck(p) {
  for (let i = DINO_STAGES.length - 1; i >= 0; i--) {
    if (p.applesEaten >= DINO_STAGES[i].applesNeeded) {
      if (p.stage !== i) {
        p.stage     = i
        p.size      = DINO_STAGES[i].size
        p.baseSpeed = DINO_STAGES[i].speed
        p.speed     = DINO_STAGES[i].speed
        p.invincible = 120
      }
      break
    }
  }
}

// ─── Spawn ────────────────────────────────────────────────────────────────────

function spawnTrees() {
  trees = []
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const forestTypes = ['tree', 'tree', 'tree', 'bush', 'bush', 'fern']
  for (let i = 0; i < 45; i++) {
    let x, y, tries = 0
    do {
      x = Math.random() * canvas.width
      y = Math.random() * canvas.height
      tries++
    } while (Math.hypot(x - cx, y - cy) < 140 && tries < 20)

    const biome = getBiome(x)
    let type
    if (biome === 'snow') {
      type = Math.random() > 0.45 ? 'snowpatch' : 'icetree'
    } else if (biome === 'desert') {
      type = Math.random() > 0.45 ? 'cactus' : 'rock'
    } else {
      type = forestTypes[Math.floor(Math.random() * forestTypes.length)]
    }

    trees.push({ x, y, scale: 0.6 + Math.random() * 0.8, type })
  }
  trees.sort((a, b) => a.y - b.y)
}

function spawnTarPits() {
  tarPits = []
  for (let i = 0; i < TAR_COUNT; i++) {
    tarPits.push({
      x: Math.random() * (canvas.width  - 200) + 100,
      y: Math.random() * (canvas.height - 200) + 100,
      r: 50 + Math.random() * 50,
    })
  }
}

function spawnApples() {
  while (apples.length < 10) {
    apples.push({
      x: Math.random() * (canvas.width  - 40) + 20,
      y: Math.random() * (canvas.height - 40) + 20,
    })
  }
}

function spawnEnemies() {
  while (enemies.length < 4) {
    const side = Math.floor(Math.random() * 4)
    let x, y
    if      (side === 0) { x = Math.random() * canvas.width;  y = -60 }
    else if (side === 1) { x = canvas.width  + 60;            y = Math.random() * canvas.height }
    else if (side === 2) { x = Math.random() * canvas.width;  y = canvas.height + 60 }
    else                 { x = -60;                            y = Math.random() * canvas.height }

    const biomeX = side === 3 ? 0 : side === 1 ? canvas.width : x
    const biome  = getBiome(biomeX)

    let type
    if (biome === 'snow')        type = 'nano'
    else if (biome === 'desert') type = 'ankylo'
    else                         type = Math.random() > 0.5 ? 'trex' : 'spino'

    const p = ENEMY_PROPS[type]
    enemies.push({
      x, y, type,
      size:      p.size,
      baseSpeed: p.baseSpeed,
      color:     p.color,
      dead:      false,
      hitCooldown: 0,
      wanderAngle: Math.random() * Math.PI * 2,
      wanderTimer: 0,
      isWandering: false,
      facing: 1,
    })
  }
}

function spawnBoss() {
  boss = {
    x: -150,
    y: canvas.height / 2,
    size: 130,
    baseSpeed: 0.9,
    hp: 10,
    maxHp: 10,
    hitCooldown: 0,
    invincible: 0,
    facing: 1,
  }
}

function updateBoss() {
  const target = getNearestAlivePlayer(boss.x, boss.y)
  if (!target) return

  if (boss.invincible > 0) boss.invincible--
  if (boss.hitCooldown > 0) boss.hitCooldown--

  const tx = target.x + target.size / 2
  const ty = target.y + target.size / 2
  const angle = Math.atan2(ty - boss.y, tx - boss.x)
  boss.x += Math.cos(angle) * boss.baseSpeed
  boss.y += Math.sin(angle) * boss.baseSpeed
  boss.facing = Math.cos(angle) < 0 ? -1 : 1

  boss.x = Math.max(boss.size / 2, Math.min(canvas.width  - boss.size / 2, boss.x))
  boss.y = Math.max(boss.size / 2, Math.min(canvas.height - boss.size / 2, boss.y))

  const bossAttackRange = ATTACK_RANGE + 40

  if (player.alive) {
    const px    = player.x + player.size / 2
    const py    = player.y + player.size / 2
    const dist1 = Math.hypot(px - boss.x, py - boss.y)
    if (spaceJustPressed && dist1 < bossAttackRange && boss.invincible === 0) {
      boss.hp--
      boss.invincible = 25
      if (boss.hp <= 0) { score += 500; updateUI(); boss = null; return }
    }
    if (boss && dist1 < player.size / 2 + boss.size / 2) damagePlayer(player)
  }
}

function spawnBoss2() {
  boss2 = {
    x: canvas.width + 180,
    y: canvas.height / 2,
    size: 160,
    baseSpeed: 0.75,
    hp: 20,
    maxHp: 20,
    hitCooldown: 0,
    invincible: 0,
    facing: -1,
  }
}

function updateBoss2() {
  const target = getNearestAlivePlayer(boss2.x, boss2.y)
  if (!target) return

  if (boss2.invincible > 0) boss2.invincible--
  if (boss2.hitCooldown > 0) boss2.hitCooldown--

  const tx = target.x + target.size / 2
  const ty = target.y + target.size / 2
  const angle = Math.atan2(ty - boss2.y, tx - boss2.x)
  boss2.x += Math.cos(angle) * boss2.baseSpeed
  boss2.y += Math.sin(angle) * boss2.baseSpeed
  boss2.facing = Math.cos(angle) < 0 ? -1 : 1

  boss2.x = Math.max(boss2.size / 2, Math.min(canvas.width  - boss2.size / 2, boss2.x))
  boss2.y = Math.max(boss2.size / 2, Math.min(canvas.height - boss2.size / 2, boss2.y))

  const b2AttackRange = ATTACK_RANGE + 60

  if (player.alive) {
    const px    = player.x + player.size / 2
    const py    = player.y + player.size / 2
    const dist1 = Math.hypot(px - boss2.x, py - boss2.y)
    if (spaceJustPressed && dist1 < b2AttackRange && boss2.invincible === 0) {
      boss2.hp--
      boss2.invincible = 20
      if (boss2.hp <= 0) { score += 1000; updateUI(); boss2 = null; return }
    }
    if (boss2 && dist1 < player.size / 2 + boss2.size / 2) damagePlayer(player)
  }
}

function spawnBoss3() {
  boss3 = {
    x: canvas.width / 2,
    y: -170,
    size: 145,
    baseSpeed: 1.2,
    hp: 35,
    maxHp: 35,
    hitCooldown: 0,
    invincible: 0,
    shootCooldown: 140,
    facing: 1,
  }
  shieldPickup = {
    x: 120 + Math.random() * (canvas.width  - 240),
    y: 120 + Math.random() * (canvas.height - 240),
  }
}

function updateBoss3() {
  const target = getNearestAlivePlayer(boss3.x, boss3.y)
  if (!target) return

  if (boss3.invincible > 0) boss3.invincible--
  if (boss3.hitCooldown > 0) boss3.hitCooldown--
  if (boss3.shootCooldown > 0) boss3.shootCooldown--

  const tx = target.x + target.size / 2
  const ty = target.y + target.size / 2
  const angle = Math.atan2(ty - boss3.y, tx - boss3.x)
  boss3.x += Math.cos(angle) * boss3.baseSpeed
  boss3.y += Math.sin(angle) * boss3.baseSpeed
  boss3.facing = Math.cos(angle) < 0 ? -1 : 1

  boss3.x = Math.max(boss3.size / 2, Math.min(canvas.width  - boss3.size / 2, boss3.x))
  boss3.y = Math.max(boss3.size / 2, Math.min(canvas.height - boss3.size / 2, boss3.y))

  if (boss3.shootCooldown <= 0) {
    const shotAngle = Math.atan2(ty - boss3.y, tx - boss3.x)
    boss3Projectiles.push({
      x: boss3.x,
      y: boss3.y,
      dx: Math.cos(shotAngle) * 5.5,
      dy: Math.sin(shotAngle) * 5.5,
    })
    boss3.shootCooldown = 150
  }

  boss3Projectiles = boss3Projectiles.filter(p => {
    p.x += p.dx
    p.y += p.dy
    if (p.x < -60 || p.x > canvas.width + 60 || p.y < -60 || p.y > canvas.height + 60) return false

    if (player.alive) {
      const px = player.x + player.size / 2
      const py = player.y + player.size / 2
      if (Math.hypot(p.x - px, p.y - py) < player.size / 2 + 12) {
        damagePlayerUnshielded(player)
        return false
      }
    }
    return true
  })

  const b3AttackRange = ATTACK_RANGE + 50

  if (player.alive) {
    const px    = player.x + player.size / 2
    const py    = player.y + player.size / 2
    const dist1 = Math.hypot(px - boss3.x, py - boss3.y)
    if (spaceJustPressed && dist1 < b3AttackRange && boss3.invincible === 0) {
      boss3.hp--
      boss3.invincible = 18
      if (boss3.hp <= 0) { score += 1500; updateUI(); boss3 = null; boss3Projectiles = []; return }
    }
    if (boss3 && dist1 < player.size / 2 + boss3.size / 2) damagePlayer(player)
  }
}

// ─── Draw ─────────────────────────────────────────────────────────────────────

function shadeColor(hex, amt) {
  if (!hex || !hex.startsWith('#')) return hex
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, Math.min(255, (n >> 16) + amt))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xFF) + amt))
  const b = Math.max(0, Math.min(255, (n & 0xFF) + amt))
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
}

function dinoGalli(ctx, col) {
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'
  ctx.lineWidth = 3.5
  ctx.beginPath(); ctx.moveTo(-7, 2); ctx.quadraticCurveTo(-17, 0, -21, -5); ctx.stroke()
  ctx.fillStyle = col
  ctx.beginPath(); ctx.ellipse(-1, 3, 8, 5.5, -0.3, 0, Math.PI * 2); ctx.fill()
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(6, -2); ctx.quadraticCurveTo(9, -13, 17, -17); ctx.stroke()
  ctx.fillStyle = col
  ctx.beginPath(); ctx.ellipse(19, -19, 5, 3.5, 0.3, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.moveTo(23, -20); ctx.lineTo(26, -19); ctx.lineTo(23, -17); ctx.closePath(); ctx.fill()
  ctx.fillStyle = 'white'
  ctx.beginPath(); ctx.arc(21, -21, 1.8, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#222'
  ctx.beginPath(); ctx.arc(21.5, -21, 1, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = col; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(5, -1); ctx.lineTo(8, 3); ctx.stroke()
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(-3, 8); ctx.lineTo(-5, 19); ctx.lineTo(-9, 23); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(2, 8); ctx.lineTo(2, 19); ctx.lineTo(-2, 23); ctx.stroke()
}

function dinoRaptor(ctx, col) {
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'
  ctx.lineWidth = 5
  ctx.beginPath(); ctx.moveTo(-9, 3); ctx.quadraticCurveTo(-19, 0, -22, -6); ctx.stroke()
  ctx.fillStyle = col
  ctx.beginPath(); ctx.ellipse(0, 2, 11, 7, -0.3, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(4, -4); ctx.lineTo(8, -15); ctx.lineTo(5, -15); ctx.lineTo(1, -4); ctx.closePath(); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(5, -15); ctx.lineTo(5, -20); ctx.lineTo(22, -16); ctx.lineTo(24, -10); ctx.lineTo(7, -8); ctx.lineTo(8, -15)
  ctx.closePath(); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(7, -8); ctx.lineTo(24, -10); ctx.lineTo(22, -4); ctx.lineTo(7, -4); ctx.closePath(); ctx.fill()
  ctx.fillStyle = 'white'
  ctx.beginPath(); ctx.arc(15, -15, 2.8, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#c00'
  ctx.beginPath(); ctx.arc(16, -15, 1.4, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ;[[9,-8],[13,-9],[17,-9]].forEach(([x,y]) => {
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+2,y+4); ctx.lineTo(x+4,y); ctx.closePath(); ctx.fill()
  })
  ctx.strokeStyle = col; ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.moveTo(4, -4); ctx.lineTo(12, 1); ctx.lineTo(10, 6); ctx.stroke()
  ctx.lineWidth = 5.5
  ctx.beginPath(); ctx.moveTo(-3, 10); ctx.lineTo(-4, 19); ctx.lineTo(-10, 22); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(3, 10); ctx.lineTo(4, 19); ctx.lineTo(10, 22); ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(4, 19); ctx.quadraticCurveTo(12, 16, 13, 21); ctx.stroke()
}

function dinoTRex(ctx, col) {
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'
  ctx.lineWidth = 7
  ctx.beginPath(); ctx.moveTo(-13, 5); ctx.quadraticCurveTo(-22, 1, -24, -3); ctx.stroke()
  ctx.fillStyle = col
  ctx.beginPath(); ctx.ellipse(-2, 5, 14, 10, -0.1, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(3, -4); ctx.lineTo(7, -15); ctx.lineTo(4, -15); ctx.lineTo(-1, -4); ctx.closePath(); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(4, -15); ctx.lineTo(4, -22); ctx.lineTo(22, -18); ctx.lineTo(24, -11); ctx.lineTo(6, -9); ctx.lineTo(7, -15)
  ctx.closePath(); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(6, -9); ctx.lineTo(24, -11); ctx.lineTo(22, -4); ctx.lineTo(6, -4); ctx.closePath(); ctx.fill()
  ctx.fillStyle = 'white'
  ctx.beginPath(); ctx.arc(15, -18, 3, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#111'
  ctx.beginPath(); ctx.arc(16, -18, 1.5, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ;[[9,-9],[13,-10],[17,-10]].forEach(([x,y]) => {
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+2,y+4); ctx.lineTo(x+4,y); ctx.closePath(); ctx.fill()
  })
  ctx.strokeStyle = col; ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.moveTo(3, -3); ctx.lineTo(9, 2); ctx.lineTo(8, 6); ctx.stroke()
  ctx.lineWidth = 6.5
  ctx.beginPath(); ctx.moveTo(-4, 14); ctx.lineTo(-5, 22); ctx.lineTo(-12, 25); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(3, 14); ctx.lineTo(3, 22); ctx.lineTo(10, 25); ctx.stroke()
}

function dinoSpino(ctx, col) {
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'
  ctx.fillStyle = col; ctx.globalAlpha = 0.65
  ctx.beginPath()
  ctx.moveTo(-9, -5); ctx.lineTo(-7, -34); ctx.lineTo(0, -32); ctx.lineTo(5, -5)
  ctx.closePath(); ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = shadeColor(col, 35); ctx.lineWidth = 1.2
  ;[[-9,-5,-8,-33],[-5,-5,-4,-33],[0,-5,0,-32],[4,-5,3,-31]].forEach(([x1,y1,x2,y2]) => {
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke()
  })
  ctx.strokeStyle = col
  ctx.lineWidth = 7
  ctx.beginPath(); ctx.moveTo(-13, 5); ctx.quadraticCurveTo(-22, 1, -24, -3); ctx.stroke()
  ctx.fillStyle = col
  ctx.beginPath(); ctx.ellipse(-2, 5, 14, 10, -0.1, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(3, -4); ctx.lineTo(8, -16); ctx.lineTo(5, -16); ctx.lineTo(0, -4); ctx.closePath(); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(5, -16); ctx.lineTo(5, -22); ctx.lineTo(26, -18); ctx.lineTo(28, -11); ctx.lineTo(7, -9); ctx.lineTo(8, -16)
  ctx.closePath(); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(7, -9); ctx.lineTo(28, -11); ctx.lineTo(26, -4); ctx.lineTo(7, -4); ctx.closePath(); ctx.fill()
  ctx.fillStyle = 'white'
  ctx.beginPath(); ctx.arc(17, -18, 3, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#0055cc'
  ctx.beginPath(); ctx.arc(18, -18, 1.5, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = col; ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(3, -3); ctx.lineTo(11, 3); ctx.lineTo(10, 7); ctx.stroke()
  ctx.lineWidth = 6.5
  ctx.beginPath(); ctx.moveTo(-4, 14); ctx.lineTo(-5, 22); ctx.lineTo(-12, 25); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(3, 14); ctx.lineTo(3, 22); ctx.lineTo(10, 25); ctx.stroke()
}

function dinoAnkylo(ctx, col) {
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'
  ctx.lineWidth = 5
  ctx.beginPath(); ctx.moveTo(-18, 4); ctx.lineTo(-25, 1); ctx.stroke()
  ctx.fillStyle = shadeColor(col, -20)
  ctx.beginPath(); ctx.arc(-26, 0, 6, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = col
  ctx.beginPath(); ctx.ellipse(-1, 4, 19, 10, 0, 0, Math.PI * 2); ctx.fill()
  const lighter = shadeColor(col, 40)
  ctx.fillStyle = lighter
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath(); ctx.ellipse(i * 5, -5, 4, 3, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = col
  ctx.beginPath()
  ctx.moveTo(14, -3); ctx.lineTo(19, -5); ctx.quadraticCurveTo(25, -2, 24, 3); ctx.lineTo(16, 5)
  ctx.closePath(); ctx.fill()
  ctx.fillStyle = 'white'
  ctx.beginPath(); ctx.arc(20, -2, 2.5, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#000'
  ctx.beginPath(); ctx.arc(20.8, -2, 1.2, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = col; ctx.lineWidth = 6
  ctx.beginPath(); ctx.moveTo(-14, 12); ctx.lineTo(-16, 20); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(-5, 13); ctx.lineTo(-5, 21); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(5, 13); ctx.lineTo(5, 21); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(13, 12); ctx.lineTo(14, 20); ctx.stroke()
}

function drawDino(ctx, cx, cy, size, color, type, facing) {
  const s = size / 50
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(facing * s, s)
  switch (type) {
    case 'galli':  dinoGalli(ctx, color);  break
    case 'raptor': dinoRaptor(ctx, color); break
    case 'trex':   dinoTRex(ctx, color);   break
    case 'nano':   dinoTRex(ctx, color);   break
    case 'spino':  dinoSpino(ctx, color);  break
    case 'ankylo': dinoAnkylo(ctx, color); break
    default:       dinoTRex(ctx, color);   break
  }
  ctx.restore()
}

// ─── Boss Drawing Functions ────────────────────────────────────────────────────

function bossBronto(ctx, col) {
  const light = shadeColor(col, 35)
  const dark  = shadeColor(col, -30)
  ctx.lineCap = 'round'
  ctx.strokeStyle = dark; ctx.lineWidth = 8
  ctx.beginPath(); ctx.moveTo(-18, 4); ctx.quadraticCurveTo(-30, 1, -33, -6); ctx.stroke()
  ctx.fillStyle = col
  ctx.beginPath(); ctx.ellipse(-2, 4, 20, 11, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = light
  ctx.beginPath(); ctx.ellipse(-2, 10, 14, 5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = col; ctx.lineWidth = 10
  ctx.beginPath(); ctx.moveTo(13, -3); ctx.quadraticCurveTo(20, -18, 15, -32); ctx.stroke()
  ctx.fillStyle = col
  ctx.beginPath(); ctx.ellipse(14, -35, 7, 4, 0.25, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.moveTo(19, -37); ctx.lineTo(23, -35); ctx.lineTo(19, -32); ctx.closePath(); ctx.fill()
  ctx.fillStyle = 'white'
  ctx.beginPath(); ctx.arc(17, -37, 1.8, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#111'
  ctx.beginPath(); ctx.arc(17.5, -37, 1, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = dark; ctx.lineWidth = 8
  ctx.beginPath(); ctx.moveTo(10, 14); ctx.lineTo(11, 25); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(4, 15); ctx.lineTo(4, 25); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(-8, 14); ctx.lineTo(-9, 25); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(-15, 14); ctx.lineTo(-15, 25); ctx.stroke()
}

function bossTitano(ctx, col) {
  const light = shadeColor(col, 30)
  const dark  = shadeColor(col, -35)
  ctx.lineCap = 'round'
  ctx.strokeStyle = dark; ctx.lineWidth = 10
  ctx.beginPath(); ctx.moveTo(-20, 5); ctx.quadraticCurveTo(-33, 2, -36, -7); ctx.stroke()
  ctx.fillStyle = col
  ctx.beginPath(); ctx.ellipse(-2, 5, 22, 13, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = light
  ctx.beginPath(); ctx.ellipse(-2, 12, 16, 6, 0, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = col; ctx.lineWidth = 12
  ctx.beginPath(); ctx.moveTo(14, -4); ctx.quadraticCurveTo(22, -22, 16, -38); ctx.stroke()
  ctx.fillStyle = col
  ctx.beginPath(); ctx.ellipse(15, -42, 9, 5, 0.15, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.moveTo(21, -44); ctx.lineTo(26, -42); ctx.lineTo(21, -39); ctx.closePath(); ctx.fill()
  ctx.fillStyle = 'white'
  ctx.beginPath(); ctx.arc(19, -44, 2, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#220044'
  ctx.beginPath(); ctx.arc(19.5, -44, 1.1, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = dark; ctx.lineWidth = 10
  ctx.beginPath(); ctx.moveTo(12, 17); ctx.lineTo(13, 28); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(4, 18); ctx.lineTo(4, 28); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(-10, 17); ctx.lineTo(-11, 28); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(-17, 17); ctx.lineTo(-17, 28); ctx.stroke()
}

function bossIndominus(ctx, col, blasterReady) {
  const dark  = shadeColor(col, -20)
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'
  ctx.lineWidth = 9
  ctx.beginPath(); ctx.moveTo(-15, 5); ctx.quadraticCurveTo(-26, 1, -28, -5); ctx.stroke()
  ctx.fillStyle = col
  ctx.beginPath(); ctx.ellipse(-2, 5, 16, 12, -0.1, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(4, -5); ctx.lineTo(9, -18); ctx.lineTo(5, -18); ctx.lineTo(-1, -5); ctx.closePath(); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(6, -18); ctx.lineTo(6, -25); ctx.lineTo(30, -20); ctx.lineTo(32, -12); ctx.lineTo(8, -10); ctx.lineTo(9, -18)
  ctx.closePath(); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(8, -10); ctx.lineTo(32, -12); ctx.lineTo(30, -4); ctx.lineTo(8, -4); ctx.closePath(); ctx.fill()
  ctx.fillStyle = 'white'
  ctx.beginPath(); ctx.arc(19, -21, 3.5, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#ccaa00'
  ctx.beginPath(); ctx.arc(20, -21, 1.8, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#000'
  ctx.beginPath(); ctx.arc(20.5, -21, 0.9, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ;[[10,-10],[14,-11],[18,-11],[22,-11],[26,-11]].forEach(([x,y]) => {
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+2,y+4); ctx.lineTo(x+4,y); ctx.closePath(); ctx.fill()
  })
  ctx.strokeStyle = dark; ctx.lineWidth = 3.5
  ctx.beginPath(); ctx.moveTo(4, -4); ctx.lineTo(14, 3); ctx.lineTo(12, 8); ctx.stroke()
  const blasterCol = blasterReady ? '#ff4400' : '#888888'
  if (blasterReady) { ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 14 }
  ctx.fillStyle = blasterCol
  ctx.beginPath(); ctx.rect(30, -16, 12, 7); ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = dark; ctx.lineWidth = 8
  ctx.beginPath(); ctx.moveTo(-4, 16); ctx.lineTo(-5, 26); ctx.lineTo(-13, 29); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(4, 26); ctx.lineTo(12, 29); ctx.stroke()
}

function drawForest() {
  ctx.globalAlpha = 0.72
  trees.forEach(t => {
    const s = t.scale
    if (t.type === 'tree') {
      ctx.fillStyle = '#3b2a1a'
      ctx.fillRect(t.x - 5 * s, t.y - 26 * s, 10 * s, 26 * s)
      ctx.fillStyle = '#1a4a0e'
      ctx.beginPath(); ctx.arc(t.x, t.y - 30 * s, 22 * s, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#226614'
      ctx.beginPath(); ctx.arc(t.x - 4 * s, t.y - 34 * s, 15 * s, 0, Math.PI * 2); ctx.fill()
    } else if (t.type === 'bush') {
      ctx.fillStyle = '#1e5c0d'
      ctx.beginPath(); ctx.arc(t.x, t.y, 14 * s, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#29801a'
      ctx.beginPath(); ctx.arc(t.x - 8 * s, t.y - 5 * s, 10 * s, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(t.x + 7 * s, t.y - 4 * s, 9 * s, 0, Math.PI * 2); ctx.fill()
    } else if (t.type === 'fern') {
      ctx.strokeStyle = '#1f6b10'; ctx.lineWidth = 2 * s
      for (let i = -2; i <= 2; i++) {
        const a = (i * 0.35) - Math.PI / 2
        ctx.beginPath(); ctx.moveTo(t.x, t.y)
        ctx.lineTo(t.x + Math.cos(a) * 18 * s, t.y + Math.sin(a) * 18 * s); ctx.stroke()
      }
      ctx.lineWidth = 1
    } else if (t.type === 'snowpatch') {
      ctx.fillStyle = 'rgba(220,240,255,0.75)'
      ctx.beginPath(); ctx.ellipse(t.x, t.y, 24 * s, 11 * s, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      for (let d = 0; d < 3; d++) {
        ctx.beginPath(); ctx.arc(t.x + (d - 1) * 8 * s, t.y - 2 * s, 2 * s, 0, Math.PI * 2); ctx.fill()
      }
    } else if (t.type === 'icetree') {
      ctx.fillStyle = '#a8c8d8'
      ctx.fillRect(t.x - 4 * s, t.y - 22 * s, 8 * s, 22 * s)
      ctx.fillStyle = '#cce8f4'
      ctx.beginPath(); ctx.moveTo(t.x, t.y - 48 * s)
      ctx.lineTo(t.x - 18 * s, t.y - 22 * s); ctx.lineTo(t.x + 18 * s, t.y - 22 * s); ctx.closePath(); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.beginPath(); ctx.moveTo(t.x, t.y - 52 * s)
      ctx.lineTo(t.x - 10 * s, t.y - 36 * s); ctx.lineTo(t.x + 10 * s, t.y - 36 * s); ctx.closePath(); ctx.fill()
    } else if (t.type === 'cactus') {
      ctx.fillStyle = '#4a7c3f'
      ctx.fillRect(t.x - 5 * s, t.y - 34 * s, 10 * s, 34 * s)
      ctx.fillRect(t.x - 18 * s, t.y - 22 * s, 14 * s, 6 * s)
      ctx.fillRect(t.x - 18 * s, t.y - 32 * s, 6 * s, 12 * s)
      ctx.fillRect(t.x + 5 * s, t.y - 18 * s, 14 * s, 6 * s)
      ctx.fillRect(t.x + 13 * s, t.y - 28 * s, 6 * s, 12 * s)
    } else if (t.type === 'rock') {
      ctx.fillStyle = '#8b7355'
      ctx.beginPath(); ctx.ellipse(t.x, t.y, 17 * s, 10 * s, 0.2, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#a09070'
      ctx.beginPath(); ctx.ellipse(t.x - 3 * s, t.y - 3 * s, 11 * s, 7 * s, 0.2, 0, Math.PI * 2); ctx.fill()
    }
  })
  ctx.globalAlpha = 1
}

function drawBackground() {
  const w = canvas.width, h = canvas.height
  const z1 = w / 3
  const z2 = w * 2 / 3
  const blend = 90

  ctx.fillStyle = '#b8d8ed'; ctx.fillRect(0,  0, z1, h)
  ctx.fillStyle = '#2d5a27'; ctx.fillRect(z1, 0, z2 - z1, h)
  ctx.fillStyle = '#c8a238'; ctx.fillRect(z2, 0, w - z2, h)

  let g = ctx.createLinearGradient(z1 - blend / 2, 0, z1 + blend / 2, 0)
  g.addColorStop(0, '#b8d8ed'); g.addColorStop(1, '#2d5a27')
  ctx.fillStyle = g; ctx.fillRect(z1 - blend / 2, 0, blend, h)

  g = ctx.createLinearGradient(z2 - blend / 2, 0, z2 + blend / 2, 0)
  g.addColorStop(0, '#2d5a27'); g.addColorStop(1, '#c8a238')
  ctx.fillStyle = g; ctx.fillRect(z2 - blend / 2, 0, blend, h)
}

function drawPlayer(p, isP2) {
  if (!p || !p.alive) return

  if (p.invincible > 0 && Math.floor(p.invincible / 5) % 2 === 0) {
    ctx.globalAlpha = 0.35
  }

  const stage = DINO_STAGES[p.stage]
  const cx = p.x + p.size / 2
  const cy = p.y + p.size / 2
  drawDino(ctx, cx, cy, p.size, stage.color, stage.dinoType, p.facing)

  ctx.globalAlpha = 1

  if (p.shieldTimer > 0) {
    const pcx = p.x + p.size / 2
    const pcy = p.y + p.size / 2
    const shimmer = 0.5 + 0.3 * Math.sin(Date.now() / 130)
    ctx.strokeStyle = `rgba(0,220,255,${shimmer})`
    ctx.lineWidth = 4
    ctx.shadowColor = '#00ffff'
    ctx.shadowBlur = 16
    ctx.beginPath(); ctx.arc(pcx, pcy, p.size / 2 + 14, 0, Math.PI * 2); ctx.stroke()
    ctx.shadowBlur = 0; ctx.lineWidth = 1
  }

  ctx.fillStyle = 'white'
  ctx.font = 'bold 12px Arial'
  ctx.fillText(stage.name, p.x, p.y - 8)

  ctx.font = '14px Arial'
  const hearts = '❤️'.repeat(p.hp) + '🖤'.repeat(3 - p.hp)
  ctx.fillText(hearts, p.x, p.y - 22)

  if (p.shieldTimer > 0) {
    const secsLeft = Math.ceil(p.shieldTimer / 60)
    ctx.fillStyle = 'rgba(0,220,255,0.95)'
    ctx.font = 'bold 13px Arial'
    ctx.textAlign = 'center'
    ctx.fillText(`🛡 ${secsLeft}s`, p.x + p.size / 2, p.y - 36)
    ctx.textAlign = 'left'
  }

  if (p.inTar) {
    ctx.fillStyle = 'rgba(255,200,0,0.9)'
    ctx.font = 'bold 13px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('SLOWED', p.x + p.size / 2, p.y + p.size + 16)
    ctx.textAlign = 'left'
  }
}

// ─── Touch Controls Overlay ───────────────────────────────────────────────────

function drawTouchControls() {
  if (!gameRunning) return
  const jb  = joyBase()
  const atk = atkCenter()

  // Joystick base ring
  ctx.globalAlpha = 0.22
  ctx.fillStyle   = '#ffffff'
  ctx.beginPath(); ctx.arc(jb.x, jb.y, JOYSTICK_RADIUS, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth   = 2
  ctx.beginPath(); ctx.arc(jb.x, jb.y, JOYSTICK_RADIUS, 0, Math.PI * 2); ctx.stroke()

  // Joystick thumb
  const tx = joystick.active ? joystick.thumbX : jb.x
  const ty = joystick.active ? joystick.thumbY : jb.y
  ctx.globalAlpha = joystick.active ? 0.75 : 0.45
  ctx.fillStyle   = '#ffffff'
  ctx.beginPath(); ctx.arc(tx, ty, JOYSTICK_THUMB_RADIUS, 0, Math.PI * 2); ctx.fill()

  // Attack button
  ctx.globalAlpha = atkBtnActive ? 0.9 : 0.5
  ctx.fillStyle   = atkBtnActive ? '#ff6600' : '#cc2200'
  ctx.beginPath(); ctx.arc(atk.x, atk.y, ATK_BTN_RADIUS, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle   = 'white'
  ctx.font        = 'bold 20px Arial'
  ctx.textAlign   = 'center'
  ctx.fillText('ATK', atk.x, atk.y + 7)
  ctx.textAlign   = 'left'
  ctx.globalAlpha = 1
}

function draw() {
  drawBackground()
  drawForest()

  // Draw tar pits
  tarPits.forEach(t => {
    const grad = ctx.createRadialGradient(t.x, t.y, t.r * 0.3, t.x, t.y, t.r)
    grad.addColorStop(0, 'rgba(20, 10, 0, 0.95)')
    grad.addColorStop(1, 'rgba(40, 20, 0, 0.5)')
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.ellipse(t.x, t.y, t.r, t.r * 0.6, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,200,50,0.6)'
    ctx.font = '11px Arial'; ctx.textAlign = 'center'
    ctx.fillText('TAR', t.x, t.y + 4); ctx.textAlign = 'left'
  })

  // Draw shield pickup
  if (shieldPickup) {
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 200)
    ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 18 * pulse
    ctx.fillStyle = `rgba(0,220,255,${pulse})`
    ctx.beginPath(); ctx.arc(shieldPickup.x, shieldPickup.y, 18, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = 'white'; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center'
    ctx.fillText('🛡', shieldPickup.x, shieldPickup.y + 6)
    ctx.fillStyle = 'rgba(0,220,255,0.95)'; ctx.font = 'bold 11px Arial'
    ctx.fillText('SHIELD', shieldPickup.x, shieldPickup.y - 26); ctx.textAlign = 'left'
  }

  // Draw apples
  apples.forEach(a => {
    ctx.fillStyle = '#cc2200'
    ctx.beginPath(); ctx.arc(a.x, a.y, 12, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#006600'
    ctx.fillRect(a.x - 1, a.y - 16, 3, 8)
  })

  // Draw enemies
  enemies.forEach(e => {
    drawDino(ctx, e.x, e.y, e.size, e.color, e.type, e.facing)

    ctx.fillStyle = 'white'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'
    ctx.fillText(ENEMY_PROPS[e.type]?.label ?? e.type, e.x, e.y - e.size / 2 - 5)
    ctx.textAlign = 'left'

    if (e.isWandering) {
      ctx.fillStyle = 'rgba(200,200,50,0.85)'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'
      ctx.fillText('wanders!', e.x, e.y - e.size / 2 - 18); ctx.textAlign = 'left'
    } else {
      if (player.alive) {
        const px   = player.x + player.size / 2
        const py   = player.y + player.size / 2
        const dist = Math.hypot(px - e.x, py - e.y)
        if (dist < ATTACK_RANGE + 30) {
          ctx.strokeStyle = 'rgba(255,255,0,0.4)'; ctx.lineWidth = 2; ctx.setLineDash([5, 5])
          ctx.beginPath(); ctx.arc(e.x, e.y, ATTACK_RANGE, 0, Math.PI * 2); ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = 'rgba(255,255,0,0.9)'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'
          ctx.fillText('[ ATK ]', e.x, e.y - e.size / 2 - 18); ctx.textAlign = 'left'
        }
      }
    }
  })

  // Draw boss (Brontosaurus)
  if (boss) {
    const bossFlash = boss.invincible > 0 && Math.floor(boss.invincible / 4) % 2 === 0
    const bossCol = bossFlash ? '#ffffff' : '#8B4513'
    const bs = boss.size / 50
    ctx.save(); ctx.translate(boss.x, boss.y); ctx.scale(boss.facing * bs, bs)
    bossBronto(ctx, bossCol); ctx.restore()

    ctx.fillStyle = 'white'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'
    ctx.fillText('BRONTOSAURUS', boss.x, boss.y - boss.size / 2 - 80); ctx.textAlign = 'left'

    const barW = 100, barH = 10, barX = boss.x - barW / 2, barY = boss.y - boss.size / 2 - 96
    ctx.fillStyle = '#550000'; ctx.fillRect(barX, barY, barW, barH)
    ctx.fillStyle = '#ff3300'; ctx.fillRect(barX, barY, barW * (boss.hp / boss.maxHp), barH)
    ctx.strokeStyle = 'white'; ctx.lineWidth = 1; ctx.strokeRect(barX, barY, barW, barH)
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11px Arial'; ctx.textAlign = 'center'
    ctx.fillText(`${boss.hp} hits left`, boss.x, barY - 3); ctx.textAlign = 'left'

    const bTarget = getNearestAlivePlayer(boss.x, boss.y)
    if (bTarget) {
      const bdist = Math.hypot((bTarget.x + bTarget.size/2) - boss.x, (bTarget.y + bTarget.size/2) - boss.y)
      if (bdist < ATTACK_RANGE + 70) {
        ctx.strokeStyle = 'rgba(255,80,0,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4])
        ctx.beginPath(); ctx.arc(boss.x, boss.y, ATTACK_RANGE + 40, 0, Math.PI * 2); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(255,120,0,0.95)'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'
        ctx.fillText('[ ATK ] × 10', boss.x, boss.y - boss.size / 2 - 94); ctx.textAlign = 'left'
      }
    }
  }

  // Draw Titanosaurus boss2
  if (boss2) {
    const flash2 = boss2.invincible > 0 && Math.floor(boss2.invincible / 4) % 2 === 0
    const boss2Col = flash2 ? '#ffffff' : '#4a3a6a'
    const b2s = boss2.size / 50
    ctx.save(); ctx.translate(boss2.x, boss2.y); ctx.scale(boss2.facing * b2s, b2s)
    bossTitano(ctx, boss2Col); ctx.restore()

    ctx.fillStyle = 'white'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'
    ctx.fillText('TITANOSAURUS', boss2.x, boss2.y - boss2.size / 2 - 98); ctx.textAlign = 'left'

    const b2W = 130, b2H = 11, b2X = boss2.x - b2W / 2, b2Y = boss2.y - boss2.size / 2 - 112
    ctx.fillStyle = '#330055'; ctx.fillRect(b2X, b2Y, b2W, b2H)
    ctx.fillStyle = '#aa00ff'; ctx.fillRect(b2X, b2Y, b2W * (boss2.hp / boss2.maxHp), b2H)
    ctx.strokeStyle = 'white'; ctx.lineWidth = 1; ctx.strokeRect(b2X, b2Y, b2W, b2H)
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11px Arial'; ctx.textAlign = 'center'
    ctx.fillText(`${boss2.hp} / ${boss2.maxHp} hits`, boss2.x, b2Y - 3); ctx.textAlign = 'left'

    const b2Target = getNearestAlivePlayer(boss2.x, boss2.y)
    if (b2Target) {
      const b2dist = Math.hypot((b2Target.x + b2Target.size/2) - boss2.x, (b2Target.y + b2Target.size/2) - boss2.y)
      if (b2dist < ATTACK_RANGE + 90) {
        ctx.strokeStyle = 'rgba(170,0,255,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4])
        ctx.beginPath(); ctx.arc(boss2.x, boss2.y, ATTACK_RANGE + 60, 0, Math.PI * 2); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(200,100,255,0.95)'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'
        ctx.fillText('[ ATK ] × 20', boss2.x, boss2.y - boss2.size / 2 - 116); ctx.textAlign = 'left'
      }
    }
  }

  // Boss announcement banners
  if (bossAnnounce > 0) {
    const alpha = Math.min(1, bossAnnounce / 30) * Math.min(1, bossAnnounce / 30)
    ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, canvas.height / 2 - 55, canvas.width, 90)
    ctx.fillStyle = '#ff4400'; ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center'
    ctx.fillText('⚠ BRONTOSAURUS BOSS ⚠', canvas.width / 2, canvas.height / 2)
    ctx.fillStyle = 'white'; ctx.font = '18px Arial'
    ctx.fillText('Tap ATK 10 times to defeat it!', canvas.width / 2, canvas.height / 2 + 28)
    ctx.textAlign = 'left'; ctx.globalAlpha = 1
  }

  // Draw Indominus Rex projectiles
  boss3Projectiles.forEach(p => {
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16)
    grad.addColorStop(0, 'white'); grad.addColorStop(0.35, '#ff2200'); grad.addColorStop(1, 'rgba(255,0,0,0)')
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2); ctx.fill()
  })

  // Draw Indominus Rex boss3
  if (boss3) {
    const flash3 = boss3.invincible > 0 && Math.floor(boss3.invincible / 4) % 2 === 0
    const boss3Col = flash3 ? '#ffffff' : '#d8d8d0'
    const blasterReady = boss3.shootCooldown <= 30
    const b3s = boss3.size / 50
    ctx.save(); ctx.translate(boss3.x, boss3.y); ctx.scale(boss3.facing * b3s, b3s)
    bossIndominus(ctx, boss3Col, blasterReady); ctx.restore()

    ctx.fillStyle = 'white'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'
    ctx.fillText('INDOMINUS REX', boss3.x, boss3.y - boss3.size / 2 - 90); ctx.textAlign = 'left'

    const b3W = 150, b3H = 11, b3X = boss3.x - b3W / 2, b3Y = boss3.y - boss3.size / 2 - 105
    ctx.fillStyle = '#003300'; ctx.fillRect(b3X, b3Y, b3W, b3H)
    const hpFrac = boss3.hp / boss3.maxHp
    ctx.fillStyle = hpFrac > 0.5 ? '#00cc44' : hpFrac > 0.25 ? '#ffaa00' : '#ff2200'
    ctx.fillRect(b3X, b3Y, b3W * hpFrac, b3H)
    ctx.strokeStyle = 'white'; ctx.lineWidth = 1; ctx.strokeRect(b3X, b3Y, b3W, b3H)
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11px Arial'; ctx.textAlign = 'center'
    ctx.fillText(`${boss3.hp} / ${boss3.maxHp} hits`, boss3.x, b3Y - 3); ctx.textAlign = 'left'

    const b3Target = getNearestAlivePlayer(boss3.x, boss3.y)
    if (b3Target) {
      const b3dist = Math.hypot((b3Target.x + b3Target.size/2) - boss3.x, (b3Target.y + b3Target.size/2) - boss3.y)
      if (b3dist < ATTACK_RANGE + 80) {
        ctx.strokeStyle = 'rgba(0,200,80,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4])
        ctx.beginPath(); ctx.arc(boss3.x, boss3.y, ATTACK_RANGE + 50, 0, Math.PI * 2); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(100,255,150,0.95)'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'
        ctx.fillText('[ ATK ] × 35', boss3.x, boss3.y - boss3.size / 2 - 109); ctx.textAlign = 'left'
      }
    }
  }

  // Titanosaurus announcement
  if (boss2Announce > 0) {
    const alpha2 = Math.min(1, boss2Announce / 30) * Math.min(1, boss2Announce / 30)
    ctx.globalAlpha = alpha2
    ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(0, canvas.height / 2 - 55, canvas.width, 90)
    ctx.fillStyle = '#bb00ff'; ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center'
    ctx.fillText('⚠ TITANOSAURUS BOSS ⚠', canvas.width / 2, canvas.height / 2)
    ctx.fillStyle = 'white'; ctx.font = '18px Arial'
    ctx.fillText('Tap ATK 20 times to defeat it!', canvas.width / 2, canvas.height / 2 + 28)
    ctx.textAlign = 'left'; ctx.globalAlpha = 1
  }

  // Indominus Rex announcement
  if (boss3Announce > 0) {
    const alpha3 = Math.min(1, boss3Announce / 30) * Math.min(1, boss3Announce / 30)
    ctx.globalAlpha = alpha3
    ctx.fillStyle = 'rgba(0,0,0,0.80)'; ctx.fillRect(0, canvas.height / 2 - 55, canvas.width, 90)
    ctx.fillStyle = '#00ff88'; ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center'
    ctx.fillText('⚠ INDOMINUS REX ⚠', canvas.width / 2, canvas.height / 2)
    ctx.fillStyle = 'white'; ctx.font = '18px Arial'
    ctx.fillText('Tap ATK 35 times — watch out for its blaster!', canvas.width / 2, canvas.height / 2 + 28)
    ctx.textAlign = 'left'; ctx.globalAlpha = 1
  }

  // Draw players
  drawPlayer(player, false)

  // Touch control overlay (drawn last, on top)
  drawTouchControls()
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function updateUI() {
  document.getElementById('apple-count').textContent = `🍎 ${player.applesEaten}`
  document.getElementById('dino-name').textContent   = `🦕 ${DINO_STAGES[player.stage].name}`
  document.getElementById('score').textContent       = `Score: ${score}`
  document.getElementById('hp-display').textContent  = `HP: ${'♥'.repeat(player.hp)}${'♡'.repeat(3 - player.hp)}`
}

function endGame() {
  gameRunning = false
  document.getElementById('game-over').classList.remove('hidden')
  document.getElementById('final-score').textContent =
    `Score: ${score}  |  Apples: ${player.applesEaten}  |  Stage: ${DINO_STAGES[player.stage].name}`
}
