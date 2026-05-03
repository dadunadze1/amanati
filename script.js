const IMAGE_PATH = "assets/images/";

const symbols = ["npc1.png", "npc2.png", "npc3.png", "npc4.png", "car.png"];
const WILD = "car.png";
const COIN = "coin.png";

const basePayout = {
  "npc1.png": 100,
  "npc2.png": 200,
  "npc3.png": 300,
  "npc4.png": 400
};

let balance = Number(localStorage.getItem("slotBalance")) || 1000;
let maxBalance = Number(localStorage.getItem("slotMaxBalance")) || balance;
let bet = Number(localStorage.getItem("slotBet")) || 10;
let totalBet = Number(localStorage.getItem("slotTotalBet")) || 0;
let totalPaid = Number(localStorage.getItem("slotTotalPaid")) || 0;

let playMode = 1;
let spinning = false;

const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContextClass();

document.body.addEventListener("click", () => {
  if(audioCtx.state === "suspended") audioCtx.resume();
}, { once:true });

const spinBtn = document.getElementById("spinBtn");
const balanceBox = document.getElementById("balance");
const maxBalanceBox = document.getElementById("maxBalance");
const rtpBox = document.getElementById("rtp");
const messageBox = document.getElementById("message");
const betInput = document.getElementById("betInput");
const screenFlash = document.getElementById("screenFlash");

betInput.value = bet;

initReels();
updateUI();
updateBetButtons();

function initReels(){
  for(let i = 0; i < 9; i++){
    setReelStatic(i, randomSymbol());
  }
}

function randomSymbol(){
  return symbols[Math.floor(Math.random() * symbols.length)];
}

function setReelStatic(index, symbol){
  const reel = document.getElementById("r" + index);
  reel.style.transition = "none";
  reel.style.transform = "translateY(0)";
  reel.innerHTML = `<img src="${IMAGE_PATH + symbol}" alt="">`;
}

function buildSpinReel(index, finalSymbol){
  const reel = document.getElementById("r" + index);
  reel.innerHTML = "";

  for(let i = 0; i < 16; i++){
    const img = document.createElement("img");
    img.src = IMAGE_PATH + randomSymbol();
    reel.appendChild(img);
  }

  const finalImg = document.createElement("img");
  finalImg.src = IMAGE_PATH + finalSymbol;
  reel.appendChild(finalImg);

  reel.style.transition = "none";
  reel.style.transform = "translateY(0)";
}

function animateReel(index, delay){
  const reel = document.getElementById("r" + index);
  const cellSize = window.innerWidth <= 900 ? 90 : 130;
  const distance = cellSize * 16;

  setTimeout(() => {
    reel.style.transition = "transform 1.15s cubic-bezier(.12,.72,.15,1)";
    reel.style.transform = `translateY(-${distance}px)`;
  }, delay);
}

function setMode(mode){
  if(spinning) return;

  playMode = mode;
  document.getElementById("oneLineBtn").classList.toggle("active", mode === 1);
  document.getElementById("threeLineBtn").classList.toggle("active", mode === 3);
  clearLines();
}

function setBet(amount){
  if(spinning) return;

  bet = amount;
  betInput.value = amount;
  localStorage.setItem("slotBet", bet);
  updateBetButtons();
}

function customBet(){
  if(spinning) return;

  bet = Number(betInput.value) || 1;
  if(bet < 1) bet = 1;

  localStorage.setItem("slotBet", bet);
  updateBetButtons();
}

function updateBetButtons(){
  [10,20,30,40].forEach(value => {
    const btn = document.getElementById("bet" + value);
    btn.classList.toggle("active", Number(betInput.value) === value);
  });
}

function getWeightedWinner(){
  const pool = [
    ...Array(80).fill("npc1.png"),
    ...Array(60).fill("npc2.png"),
    ...Array(50).fill("npc3.png"),
    ...Array(10).fill("npc4.png")
  ];

  return pool[Math.floor(Math.random() * pool.length)];
}

function spin(){
  if(spinning) return;

  if(audioCtx.state === "suspended") audioCtx.resume();

  bet = Number(betInput.value) || 1;
  if(bet < 1) bet = 1;

  if(balance < bet){
    messageBox.innerText = "არ გაქვს საკმარისი ₾";
    playLoseSound();
    return;
  }

  spinning = true;
  spinBtn.disabled = true;
  clearLines();

  balance -= bet;
  totalBet += bet;

  saveGame();
  updateUI();

  messageBox.innerText = "SPINNING...";
  playSpinSound();

  const final = generateFinalResult();

  for(let i = 0; i < 9; i++){
    buildSpinReel(i, final[i]);
    animateReel(i, i * 80);
  }

  setTimeout(() => {
    finishSpin(final);
  }, 1900);
}

function generateFinalResult(){
  const final = [];

  for(let i = 0; i < 9; i++){
    final.push(randomSymbol());
  }

  const winChance = {
    "npc1.png": 0.80,
    "npc2.png": 0.60,
    "npc3.png": 0.50,
    "npc4.png": 0.10
  };

  const winner = getWeightedWinner();

  if(Math.random() < winChance[winner]){
    const lines = playMode === 1
      ? [[3,4,5]]
      : [[0,1,2],[3,4,5],[6,7,8]];

    const selectedLine = lines[Math.floor(Math.random() * lines.length)];

    selectedLine.forEach((cellIndex, position) => {
      final[cellIndex] = position === 1 && Math.random() < 0.35 ? WILD : winner;
    });
  }else{
    preventAccidentalWins(final);
  }

  return final;
}

function preventAccidentalWins(final){
  const lines = playMode === 1
    ? [[3,4,5]]
    : [[0,1,2],[3,4,5],[6,7,8]];

  lines.forEach(line => {
    while(getLineWinSymbol(line.map(i => final[i]))){
      final[line[2]] = randomSymbol();
    }
  });
}

function finishSpin(final){
  const lines = playMode === 1
    ? [{cells:[3,4,5], el:"lineMid"}]
    : [
        {cells:[0,1,2], el:"lineTop"},
        {cells:[3,4,5], el:"lineMid"},
        {cells:[6,7,8], el:"lineBot"}
      ];

  let totalWin = 0;
  let winCount = 0;
  let bossTriggered = false;

  lines.forEach(line => {
    const lineSymbols = line.cells.map(i => final[i]);
    const winSymbol = getLineWinSymbol(lineSymbols);

    if(winSymbol){
      const payout = Math.floor((basePayout[winSymbol] * bet) / 10);
      totalWin += payout;
      winCount++;

      document.getElementById(line.el).classList.add("active");

      if(winSymbol === "npc3.png" || winSymbol === "npc4.png"){
        bossTriggered = true;
      }
    }
  });

  if(totalWin > 0){
    balance += totalWin;
    totalPaid += totalWin;

    if(balance > maxBalance){
      maxBalance = balance;
    }

    messageBox.innerText = winCount + " LINE WIN +" + totalWin + "₾";
    winEffect();
    playWinSound();

    if(bossTriggered){
      showBoss();
      coinRain();
      playCoinRainSound();
    }
  }else{
    messageBox.innerText = "NO WIN -" + bet + "₾";
  }

  saveGame();
  updateUI();

  spinning = false;
  spinBtn.disabled = false;
}

function getLineWinSymbol(lineSymbols){
  const noWild = lineSymbols.filter(symbol => symbol !== WILD);

  if(noWild.length === 0){
    return "npc4.png";
  }

  const first = noWild[0];
  const same = noWild.every(symbol => symbol === first);

  return same && basePayout[first] ? first : null;
}

function showBoss(){
  const boss = document.getElementById("boss");
  boss.classList.remove("show");
  void boss.offsetWidth;
  boss.classList.add("show");
}

function coinRain(){
  for(let i = 0; i < 50; i++){
    const coin = document.createElement("img");
    coin.src = IMAGE_PATH + COIN;
    coin.className = "fallingCoin";
    coin.style.left = Math.random() * 100 + "vw";
    coin.style.animationDelay = Math.random() * 0.7 + "s";
    coin.style.animationDuration = (1.6 + Math.random() * 1.8) + "s";

    document.body.appendChild(coin);

    setTimeout(() => {
      coin.remove();
    }, 4200);
  }
}

function clearLines(){
  document.getElementById("lineTop").classList.remove("active");
  document.getElementById("lineMid").classList.remove("active");
  document.getElementById("lineBot").classList.remove("active");
}

function winEffect(){
  screenFlash.classList.remove("active");
  void screenFlash.offsetWidth;
  screenFlash.classList.add("active");
}

function updateUI(){
  balanceBox.innerText = balance + "₾";
  maxBalanceBox.innerText = maxBalance + "₾";

  const rtp = totalBet > 0 ? ((totalPaid / totalBet) * 100).toFixed(1) : "0.0";
  rtpBox.innerText = rtp + "%";
}

function saveGame(){
  localStorage.setItem("slotBalance", balance);
  localStorage.setItem("slotMaxBalance", maxBalance);
  localStorage.setItem("slotBet", bet);
  localStorage.setItem("slotTotalBet", totalBet);
  localStorage.setItem("slotTotalPaid", totalPaid);
}

function resetGame(){
  if(spinning) return;

  balance = 1000;
  maxBalance = 1000;
  totalBet = 0;
  totalPaid = 0;

  saveGame();
  updateUI();
  clearLines();

  messageBox.innerText = "RESET DONE";
}

function playTone(freq, duration, type="square", volume=.06){
  if(audioCtx.state === "suspended") audioCtx.resume();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.stop(audioCtx.currentTime + duration);
}

function playSpinSound(){
  playTone(150,.09);
  setTimeout(() => playTone(210,.09),90);
  setTimeout(() => playTone(280,.09),180);
  setTimeout(() => playTone(360,.09),270);
  setTimeout(() => playTone(450,.09),360);
}

function playWinSound(){
  playTone(520,.12);
  setTimeout(() => playTone(700,.12),130);
  setTimeout(() => playTone(900,.16),260);
  setTimeout(() => playTone(1150,.22),420);
}

function playCoinRainSound(){
  for(let i = 0; i < 12; i++){
    setTimeout(() => {
      playTone(650 + Math.random() * 650, .05, "square", .035);
    }, i * 65);
  }
}

function playLoseSound(){
  playTone(120,.18,"sawtooth",.04);
}
