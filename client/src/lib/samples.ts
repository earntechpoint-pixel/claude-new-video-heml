export interface Sample {
  id: string;
  name: string;
  /** Loop length in seconds; the sample is seamless when rendered for exactly this long. */
  loopSeconds: number;
  html: string;
}

const ORBITS = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Orbits</title>
<style>
  html, body { margin: 0; height: 100%; background: #05060f; }
  canvas { display: block; width: 100vw; height: 100vh; object-fit: contain; }
</style>
</head>
<body>
<canvas id="c" width="1280" height="720"></canvas>
<script>
  // Loop length: 6 seconds. Every motion uses an INTEGER number of cycles per loop,
  // so draw(6) looks exactly like draw(0).
  var LOOP = 6;
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');

  window.draw = function (t) {
    var w = canvas.width, h = canvas.height, s = w / 1280;
    var p = (t / LOOP) * Math.PI * 2;

    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'hsl(' + (235 + 25 * Math.sin(p)) + ', 60%, 10%)');
    g.addColorStop(1, 'hsl(' + (285 - 25 * Math.sin(p)) + ', 60%, 18%)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    var dots = 14;
    for (var ring = 0; ring < 3; ring++) {
      var r = (150 + ring * 95) * s;
      var dir = ring % 2 ? -1 : 1;
      for (var i = 0; i < dots; i++) {
        var a = dir * p * (ring + 1) + (i / dots) * Math.PI * 2;
        var x = w / 2 + Math.cos(a) * r * 1.6;
        var y = h / 2 + Math.sin(a) * r * 0.8;
        var size = (9 + 6 * Math.sin(2 * p + i * 0.9)) * s;
        ctx.shadowColor = 'hsl(' + ((i / dots) * 360 + ring * 40) + ', 90%, 60%)';
        ctx.shadowBlur = 18 * s;
        ctx.fillStyle = ctx.shadowColor;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, (46 + 10 * Math.sin(3 * p)) * s, 0, Math.PI * 2);
    ctx.fill();
  };
  window.draw(0);
</script>
</body>
</html>`;

const WAVES = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Wave ribbons</title>
<style>
  html, body { margin: 0; height: 100%; background: #07101c; }
  canvas { display: block; width: 100vw; height: 100vh; object-fit: contain; }
</style>
</head>
<body>
<canvas id="c" width="1280" height="720"></canvas>
<script>
  // Loop length: 4 seconds. Wave speeds are whole multiples of the loop frequency.
  var LOOP = 4;
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');

  window.draw = function (t) {
    var w = canvas.width, h = canvas.height, s = w / 1280;
    var p = (t / LOOP) * Math.PI * 2;

    ctx.fillStyle = '#07101c';
    ctx.fillRect(0, 0, w, h);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var k = 0; k < 5; k++) {
      var amp = (50 + 35 * Math.sin(p + k)) * s;
      ctx.strokeStyle = 'hsl(' + (170 + k * 28) + ', 85%, ' + (55 + k * 3) + '%)';
      ctx.lineWidth = (7 - k) * s;
      ctx.globalAlpha = 0.9 - k * 0.1;
      ctx.beginPath();
      for (var x = 0; x <= w; x += 8) {
        var u = x / w;
        var y = h * 0.42 + Math.sin(u * Math.PI * 2 * (k + 1) + p * (k + 1)) * amp
              + Math.sin(u * Math.PI * 6 - 2 * p) * 12 * s;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    var bars = 48, bw = w / bars;
    for (var i = 0; i < bars; i++) {
      var level = 0.5 + 0.5 * Math.sin(p * (1 + (i % 3)) + i * 0.5);
      var bh = (20 + level * 110) * s;
      ctx.fillStyle = 'hsl(' + (200 + i * 3) + ', 80%, ' + (35 + level * 30) + '%)';
      ctx.fillRect(i * bw + bw * 0.15, h - bh - 24 * s, bw * 0.7, bh);
    }
  };
  window.draw(0);
</script>
</body>
</html>`;

export const SAMPLES: readonly Sample[] = [
  { id: 'orbits', name: 'Orbits (6 s loop)', loopSeconds: 6, html: ORBITS },
  { id: 'waves', name: 'Wave ribbons (4 s loop)', loopSeconds: 4, html: WAVES },
];

export const MINIMAL_EXAMPLE = `<canvas id="c" width="1280" height="720"></canvas>
<script>
  var LOOP = 4; // seconds — use whole numbers of cycles per loop
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');

  window.draw = function (t) {
    var p = (t / LOOP) * Math.PI * 2;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#4af';
    ctx.beginPath();
    ctx.arc(640 + Math.cos(p) * 200, 360 + Math.sin(p) * 120, 40, 0, Math.PI * 2);
    ctx.fill();
  };
</script>`;
