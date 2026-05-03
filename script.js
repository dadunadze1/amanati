// =========================
// CONFIG
// =========================
const symbols = ["npc1","npc2","npc3","npc4","car"]; // car = WILD

const payouts = {
  npc1: 100,
  npc2: 200,
  npc3: 300,
  npc4: 400
};

let balance = 1000;
let bet = 10;
let isSpinning = false;

// =========================
// DOM
// =========================
const grid = document.querySelectorAll(".cell");
const spinBtn = document.getElementById("spinBtn");
const balanceEl = document.getElementById("balance");
const winLine = document.getElementById("winLine");

// sounds
const spinSound = new Audio("spin.mp3");
const winSound = new Audio("win.mp3");
const coinSound = new Audio("coins.mp3");

// =========================
// HELPERS
// =========================
function getRandomSymbol() {
  const rand = Math.random();

  if (rand < 0.8) return "npc1";
  if (rand < 0.8 + 0.6) return "npc2";
  if (rand < 0.8 + 0.6 + 0.5) return "npc3";
  if (rand < 0.8 + 0.6 + 0.5 + 0.1) return "npc4";

  return "car"; // wild rare
}

function setGridSymbols(arr) {
  grid.forEach((cell, i) => {
    cell.src = "images/" + arr[i] + ".png";
    cell.dataset.symbol = arr[i];
  });
}

function getGridSymbols() {
  return [...grid].map(c => c.dataset.symbol);
}

// =========================
// WIN CHECK
// =========================
function checkMiddleLine(symbolsGrid) {
  const middle = [symbolsGrid[3], symbolsGrid[4], symbolsGrid[5]];

  // WILD logic
  const base = middle.find(s => s !== "car");

  if (!base) return null;

  const win = middle.every(s => s === base || s === "car");

  if (win) return base;

  return null;
}

// =========================
// BOSS EVENT
// =========================
function triggerBoss() {
  const boss = document.getElementById("boss");
  const coinsContainer = document.getElementById("coins");

  boss.style.display = "block";

  coinSound.play();

  for (let i = 0; i < 50; i++) {
    const coin = document.createElement("img");
    coin.src = "images/coin.png";
    coin.className = "coin";

    coin.style.left = Math.random() * 100 + "%";

    coinsContainer.appendChild(coin);

    setTimeout(() => {
      coin.remove();
    }, 2000);
  }

  setTimeout(() => {
    boss.style.display = "none";
  }, 2500);
}

// =========================
// SPIN
// =========================
function spin() {
  if (isSpinning) return;

  if (balance < bet) {
    alert("არ გაქვს საკმარისი ლარი!");
    return;
  }

  isSpinning = true;
  balance -= bet;
  updateBalance();

  spinSound.play();

  let ticks = 0;

  const interval = setInterval(() => {
    const temp = [];

    for (let i = 0; i < 9; i++) {
      temp.push(symbols[Math.floor(Math.random() * symbols.length)]);
    }

    setGridSymbols(temp);

    ticks++;

    if (ticks > 15) {
      clearInterval(interval);

      const final = [];

      for (let i = 0; i < 9; i++) {
        final.push(getRandomSymbol());
      }

      setGridSymbols(final);

      evaluate(final);

      isSpinning = false;
    }

  }, 80);
}

// =========================
// RESULT
// =========================
function evaluate(gridSymbols) {
  winLine.style.opacity = 0;

  const winSymbol = checkMiddleLine(gridSymbols);

  if (winSymbol) {
    const winAmount = payouts[winSymbol] * (bet / 10);
    balance += winAmount;

    winSound.play();

    winLine.style.opacity = 1;

    // boss trigger (only npc3 or npc4)
    if (winSymbol === "npc3" || winSymbol === "npc4") {
      triggerBoss();
    }

  }

  updateBalance();
}

// =========================
// UI
// =========================
function updateBalance() {
  balanceEl.innerText = balance + " ₾";
}

// =========================
// EVENTS
// =========================
spinBtn.addEventListener("click", spin);

// BET BUTTONS
document.querySelectorAll(".bet").forEach(btn => {
  btn.onclick = () => {
    bet = parseInt(btn.dataset.bet);
  };
});

// =========================
// INIT
// =========================
updateBalance();