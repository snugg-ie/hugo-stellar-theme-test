/*
 * Floating sprinkles
 * A gentle, decorative animation: small "sprinkle" capsules (inspired by
 * static/images/sprinkles/vector/*.svg) drift, bob and slowly spin across the
 * page while steering clear of the on-screen text and media so reading is
 * never obscured.
 */
(function () {
	'use strict';

	var reduceMotion = window.matchMedia &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Colours lifted from the sprinkle motif (classic + "me" palettes).
	var COLOURS = [
		'#4799ff', // blue
		'#ff3b3b', // red
		'#33a600', // green
		'#cf4f9e', // pink
		'#3b40bd', // indigo
		'#008c9c', // teal
		'#f5a623', // amber
		'#c80064'  // magenta
	];

	// Elements whose on-screen rectangles the sprinkles avoid.
	var OBSTACLE_SELECTOR = [
		'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
		'p', 'li', 'a', 'button', '.button',
		'blockquote', 'figcaption', 'label', 'time',
		'td', 'th', 'input', 'textarea',
		'img', 'picture', 'svg'
	].join(',');

	var OBSTACLE_PADDING = 14;   // breathing room kept around content (px)
	var RESCAN_INTERVAL = 300;   // how often obstacle rects are refreshed (ms)
	var MIN_SPEED = 5;           // px/s — keeps sprinkles gently drifting
	var MAX_SPEED = 50;          // px/s — caps how fast avoidance can fling them

	var layer = null;
	var sprinkles = [];
	var obstacles = [];
	var vw = 0, vh = 0;
	var rafId = null;
	var lastTime = 0;
	var lastScan = 0;

	function rand(min, max) { return min + Math.random() * (max - min); }
	function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

	function targetCount() {
		var n = Math.round((window.innerWidth * window.innerHeight) / 70000);
		return Math.max(6, Math.min(n, 28));
	}

	function makeLayer() {
		layer = document.createElement('div');
		layer.id = 'floating-sprinkles';
		layer.setAttribute('aria-hidden', 'true');
		var s = layer.style;
		s.position = 'fixed';
		s.top = '0';
		s.left = '0';
		s.width = '100%';
		s.height = '100%';
		s.margin = '0';
		s.padding = '0';
		s.border = '0';
		s.overflow = 'hidden';
		s.pointerEvents = 'none';
		s.zIndex = '9000'; // above content, below the fixed nav (10000)
		document.body.appendChild(layer);
	}

	function refreshObstacles() {
		obstacles = [];
		var els = document.querySelectorAll(OBSTACLE_SELECTOR);
		for (var i = 0; i < els.length; i++) {
			var el = els[i];
			if (el === layer || layer.contains(el)) continue;
			var r = el.getBoundingClientRect();
			if (r.width <= 0 || r.height <= 0) continue;
			if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
			obstacles.push({
				left: r.left - OBSTACLE_PADDING,
				top: r.top - OBSTACLE_PADDING,
				right: r.right + OBSTACLE_PADDING,
				bottom: r.bottom + OBSTACLE_PADDING
			});
		}
	}

	function inObstacle(x, y) {
		for (var i = 0; i < obstacles.length; i++) {
			var o = obstacles[i];
			if (x >= o.left && x <= o.right && y >= o.top && y <= o.bottom) {
				return true;
			}
		}
		return false;
	}

	// Try to find a spot clear of text; fall back to anywhere after a few tries.
	function freeSpot() {
		for (var i = 0; i < 30; i++) {
			var x = rand(0, vw);
			var y = rand(0, vh);
			if (!inObstacle(x, y)) return { x: x, y: y };
		}
		return { x: rand(0, vw), y: rand(0, vh) };
	}

	function makeSprinkle() {
		var len = rand(14, 24);
		var thick = rand(4, 6);
		var el = document.createElement('span');
		var st = el.style;
		st.position = 'absolute';
		st.top = '0';
		st.left = '0';
		st.width = len + 'px';
		st.height = thick + 'px';
		st.borderRadius = thick + 'px';
		st.background = pick(COLOURS);
		st.opacity = '0.72';
		st.willChange = 'transform';
		layer.appendChild(el);

		var spot = freeSpot();
		return {
			el: el,
			x: spot.x,
			y: spot.y,
			vx: rand(-10, 10),
			vy: rand(-10, 10),
			angle: rand(0, 360),
			spin: rand(-15, 15),
			bobPhase: rand(0, Math.PI * 2),
			bobAmp: rand(3, 7),
			bobSpeed: rand(0.4, 1.0),
			halfW: len / 2,
			halfH: thick / 2
		};
	}

	function reconcileCount() {
		var want = targetCount();
		while (sprinkles.length < want) sprinkles.push(makeSprinkle());
		while (sprinkles.length > want) {
			var gone = sprinkles.pop();
			if (gone.el.parentNode) gone.el.parentNode.removeChild(gone.el);
		}
	}

	// Push velocity away from the nearest edge of any text rect the sprinkle
	// has wandered into, so it slides back out toward open space.
	function repel(s, cx, cy, dt) {
		for (var i = 0; i < obstacles.length; i++) {
			var o = obstacles[i];
			if (cx < o.left || cx > o.right || cy < o.top || cy > o.bottom) continue;
			var dl = cx - o.left;
			var dr = o.right - cx;
			var dtp = cy - o.top;
			var db = o.bottom - cy;
			var m = Math.min(dl, dr, dtp, db);
			var push = 60 * dt;
			if (m === dl) s.vx -= push;
			else if (m === dr) s.vx += push;
			else if (m === dtp) s.vy -= push;
			else s.vy += push;
		}
	}

	function clampSpeed(s) {
		var sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
		if (sp > MAX_SPEED) {
			s.vx *= MAX_SPEED / sp;
			s.vy *= MAX_SPEED / sp;
		} else if (sp < MIN_SPEED) {
			if (sp < 0.001) {
				s.vx = rand(-MIN_SPEED, MIN_SPEED);
				s.vy = rand(-MIN_SPEED, MIN_SPEED);
			} else {
				s.vx *= MIN_SPEED / sp;
				s.vy *= MIN_SPEED / sp;
			}
		}
	}

	function frame(now) {
		if (!lastTime) lastTime = now;
		var dt = Math.min((now - lastTime) / 1000, 0.05);
		lastTime = now;

		if (now - lastScan > RESCAN_INTERVAL) {
			refreshObstacles();
			lastScan = now;
		}

		var t = now / 1000;
		for (var i = 0; i < sprinkles.length; i++) {
			var s = sprinkles[i];

			// faint wander so motion never looks mechanical
			s.vx += rand(-6, 6) * dt;
			s.vy += rand(-6, 6) * dt;

			s.x += s.vx * dt;
			s.y += s.vy * dt;

			// gentle floating bob, applied at render time only
			var bx = Math.cos(t * s.bobSpeed + s.bobPhase) * s.bobAmp * 0.6;
			var by = Math.sin(t * s.bobSpeed + s.bobPhase) * s.bobAmp;
			var cx = s.x + bx;
			var cy = s.y + by;

			repel(s, cx, cy, dt);

			// keep on-screen, reflecting softly off the edges
			if (s.x < 0) { s.x = 0; s.vx = Math.abs(s.vx); }
			else if (s.x > vw) { s.x = vw; s.vx = -Math.abs(s.vx); }
			if (s.y < 0) { s.y = 0; s.vy = Math.abs(s.vy); }
			else if (s.y > vh) { s.y = vh; s.vy = -Math.abs(s.vy); }

			s.vx *= 0.985;
			s.vy *= 0.985;
			clampSpeed(s);

			s.angle += s.spin * dt;

			s.el.style.transform =
				'translate(' + (cx - s.halfW).toFixed(2) + 'px,' +
				(cy - s.halfH).toFixed(2) + 'px) rotate(' +
				s.angle.toFixed(2) + 'deg)';
		}

		rafId = window.requestAnimationFrame(frame);
	}

	function start() {
		if (rafId !== null) return;
		lastTime = 0;
		rafId = window.requestAnimationFrame(frame);
	}

	function stop() {
		if (rafId === null) return;
		window.cancelAnimationFrame(rafId);
		rafId = null;
	}

	// Static placement for visitors who prefer reduced motion.
	function placeStatic() {
		refreshObstacles();
		for (var i = 0; i < sprinkles.length; i++) {
			var s = sprinkles[i];
			s.el.style.transform =
				'translate(' + (s.x - s.halfW).toFixed(2) + 'px,' +
				(s.y - s.halfH).toFixed(2) + 'px) rotate(' +
				s.angle.toFixed(2) + 'deg)';
		}
	}

	function onResize() {
		vw = window.innerWidth;
		vh = window.innerHeight;
		refreshObstacles();
		reconcileCount();
		for (var i = 0; i < sprinkles.length; i++) {
			var s = sprinkles[i];
			if (s.x > vw) s.x = vw;
			if (s.y > vh) s.y = vh;
		}
		if (reduceMotion) placeStatic();
	}

	function init() {
		if (layer) return;
		vw = window.innerWidth;
		vh = window.innerHeight;
		makeLayer();
		refreshObstacles();
		reconcileCount();

		window.addEventListener('resize', onResize);

		if (reduceMotion) {
			placeStatic();
			return;
		}

		document.addEventListener('visibilitychange', function () {
			if (document.hidden) stop();
			else start();
		});

		start();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
