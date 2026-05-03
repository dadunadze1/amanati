*{box-sizing:border-box}

body{
  margin:0;
  background:#020008;
  color:white;
  font-family:monospace;
  overflow:hidden;
}

#game{
  width:100vw;
  height:100vh;
  background:
    linear-gradient(rgba(0,0,0,.18), rgba(0,0,0,.76)),
    url("bg.png") center/cover no-repeat;
  display:flex;
  justify-content:center;
  align-items:center;
  position:relative;
}

.title{
  position:absolute;
  top:28px;
  font-size:36px;
  letter-spacing:4px;
  color:#ff43dc;
  text-shadow:0 0 10px #ff00cc,0 0 25px #00ffff;
}

.main-wrap{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:30px;
}

.slot-machine{
  padding:26px;
  border:5px solid #ff00cc;
  border-radius:22px;
  background:rgba(5,5,18,.92);
  box-shadow:0 0 22px #ff00cc, inset 0 0 30px #00ffff;
}

.grid{
  display:grid;
  grid-template-columns:repeat(3,130px);
  grid-template-rows:repeat(3,130px);
  gap:12px;
  position:relative;
}

.cell{
  width:130px;
  height:130px;
  border:3px solid #00ffff;
  background:#080812;
  overflow:hidden;
  box-shadow:0 0 14px #00ffff, inset 0 0 18px #ff00cc;
  position:relative;
}

.reel{
  position:absolute;
  left:0;
  top:0;
  width:100%;
}

.reel img{
  width:130px;
  height:130px;
  object-fit:cover;
  display:block;
  image-rendering:pixelated;
}

.win-line{
  position:absolute;
  left:-14px;
  right:-14px;
  height:18px;
  border-radius:99px;
  background:#fff;
  opacity:0;
  pointer-events:none;
  box-shadow:0 0 12px #fff,0 0 25px #00ffff,0 0 55px #ff00cc;
  z-index:20;
}

.win-line.active{
  opacity:1;
  animation:lineFlash .36s ease-in-out infinite alternate;
}

.line-top{ top:56px; }
.line-mid{ top:198px; }
.line-bot{ top:340px; }

@keyframes lineFlash{
  from{transform:scaleX(.88);opacity:.45}
  to{transform:scaleX(1.05);opacity:1}
}

.controls{
  margin-top:22px;
  display:flex;
  gap:12px;
  justify-content:center;
}

.modeBtn,#spinBtn,.betBtn,#resetBtn{
  border:none;
  border-radius:14px;
  font-weight:bold;
  cursor:pointer;
  font-family:monospace;
}

.modeBtn{
  padding:12px 18px;
  background:#1b1230;
  color:#fff;
  border:2px solid #ff00cc;
  box-shadow:0 0 12px #ff00cc;
}

.modeBtn.active{
  background:#ff00cc;
  color:white;
  box-shadow:0 0 20px #ff00cc,0 0 35px #00ffff;
}

#spinBtn{
  display:block;
  margin:18px auto 0;
  padding:16px 90px;
  background:#00ffff;
  color:#070012;
  font-size:24px;
  box-shadow:0 0 18px #00ffff,0 0 38px #00ffff;
}

#spinBtn:disabled{
  opacity:.5;
  cursor:not-allowed;
}

.side-panel{
  width:285px;
  padding:20px;
  border:4px solid #00ffff;
  border-radius:22px;
  background:rgba(5,5,18,.93);
  box-shadow:0 0 22px #00ffff, inset 0 0 25px #ff00cc;
}

.side-panel h2{
  margin:0 0 15px;
  color:#ff43dc;
  text-align:center;
  text-shadow:0 0 12px #ff00cc;
}

.box{
  margin-bottom:12px;
  padding:12px;
  border:2px solid #ff00cc;
  border-radius:12px;
  background:rgba(0,0,0,.45);
  box-shadow:inset 0 0 12px #ff00cc;
}

.label{
  font-size:13px;
  color:#00ffff;
}

.value{
  font-size:25px;
  margin-top:5px;
}

#betInput{
  width:100%;
  margin-top:8px;
  padding:10px;
  border-radius:10px;
  border:2px solid #00ffff;
  background:#070012;
  color:#fff;
  font-size:22px;
  font-family:monospace;
  outline:none;
  box-shadow:0 0 12px #00ffff;
}

.bet-buttons{
  display:grid;
  grid-template-columns:repeat(2,1fr);
  gap:10px;
  margin-top:10px;
}

.betBtn{
  padding:10px;
  background:#1b1230;
  color:#fff;
  border:2px solid #00ffff;
  box-shadow:0 0 12px #00ffff;
}

.betBtn.active{
  background:#00ffff;
  color:#070012;
}

#resetBtn{
  width:100%;
  padding:10px;
  background:#ff00cc;
  color:#fff;
  box-shadow:0 0 16px #ff00cc;
}

#message{
  min-height:34px;
  font-size:17px;
  color:#ff43dc;
  text-align:center;
  text-shadow:0 0 12px #ff00cc;
}

.screenFlash{
  position:absolute;
  inset:0;
  background:rgba(255,0,220,.22);
  opacity:0;
  pointer-events:none;
}

.screenFlash.active{
  animation:screenFlash .45s ease-out;
}

@keyframes screenFlash{
  35%{opacity:1}
  100%{opacity:0}
}

.fallingCoin{
  position:fixed;
  top:-80px;
  width:48px;
  height:48px;
  object-fit:contain;
  image-rendering:pixelated;
  z-index:9999;
  pointer-events:none;
  animation:coinFall linear forwards;
  filter:drop-shadow(0 0 10px gold);
}

@keyframes coinFall{
  0%{transform:translateY(-80px) rotate(0deg) scale(.8);opacity:1}
  100%{transform:translateY(110vh) rotate(720deg) scale(1.2);opacity:0}
}

#bossPopup{
  position:fixed;
  left:50%;
  top:50%;
  width:260px;
  transform:translate(-50%,-50%) scale(0);
  z-index:9998;
  image-rendering:pixelated;
  filter:drop-shadow(0 0 25px #ff00cc);
  pointer-events:none;
}

#bossPopup.show{
  animation:bossShow 1.4s ease-out forwards;
}

@keyframes bossShow{
  0%{transform:translate(-50%,-50%) scale(0);opacity:0}
  25%{transform:translate(-50%,-50%) scale(1.15);opacity:1}
  70%{transform:translate(-50%,-50%) scale(1);opacity:1}
  100%{transform:translate(-50%,-50%) scale(0);opacity:0}
}

@media(max-width:900px){
  body{overflow:auto}

  #game{
    height:auto;
    min-height:100vh;
    padding:90px 0 30px;
  }

  .main-wrap{flex-direction:column}

  .title{
    top:18px;
    font-size:24px;
  }

  .grid{
    grid-template-columns:repeat(3,90px);
    grid-template-rows:repeat(3,90px);
  }

  .cell{
    width:90px;
    height:90px;
  }

  .reel img{
    width:90px;
    height:90px;
  }

  .line-top{top:36px}
  .line-mid{top:138px}
  .line-bot{top:240px}
}