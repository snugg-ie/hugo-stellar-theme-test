/*
 * Floating sprinkles
 * Small "sprinkle" capsules (inspired by static/images/sprinkles/vector/*.svg)
 * are sprinkled onto the page over time. Each one "falls in" along the Z axis —
 * starting large and shrinking to its resting size — landing on a text-free
 * spot. Once landed it stays mostly still with a gentle sway, and eases aside
 * to the nearest clear space if text later moves onto it (e.g. on scroll).
 */
(function () {
	'use strict';

	var reduceMotion = window.matchMedia &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Sprinkle colours, weighted toward classic red / green / blue. Accent
	// hues add variety; yellow, brown and black are left out as off-palette.
	var PRIMARY = ['#ff3b3b', '#33a600', '#4799ff']; // red, green, blue
	var ACCENT = ['#cf4f9e', '#3b40bd', '#008c9c', '#c80064']; // pink, indigo, teal, magenta

	// Elements whose on-screen rectangles the sprinkles keep clear of.
	var OBSTACLE_SELECTOR = [
		'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
		'p', 'li', 'a', 'button', '.button',
		'blockquote', 'figcaption', 'label', 'time',
		'td', 'th', 'input', 'textarea',
		'img', 'picture', 'svg',
		'[data-masonry]' // treat the whole masonry grid as one block, not its gutters
	].join(',');

	var OBSTACLE_PADDING = 14;  // breathing room kept around content (px)
	var RESCAN_INTERVAL = 300;  // idle obstacle refresh cadence (ms)
	var SCAN_THROTTLE = 100;    // fastest obstacle refresh while scrolling (ms)
	var EASE = 0.08;            // how quickly a sprinkle glides to a new spot
	var TARGET_OPACITY = 0.72;
	var ENTER_MIN = 700, ENTER_MAX = 1300;   // "sprinkle in" duration (ms)
	var START_SCALE_MIN = 2.0, START_SCALE_MAX = 2.8;
	// Each sprinkle lingers for a while, then recedes and is replaced, so a
	// gentle trickle of fresh ones keeps coming.
	var LIFE_MIN = 14000, LIFE_MAX = 32000;
	var EXIT_DUR = 900;                      // fade-out duration (ms)
	// Gap between new sprinkles curves from a quick initial rush (near-empty)
	// out to a slow trickle (near the density cap).
	var SPAWN_FAST = 120, SPAWN_SLOW = 1100;

	var layer = null;
	var sprinkles = [];
	var obstacles = [];
	var cap = 0;
	var vw = 0, vh = 0;
	var rafId = null;
	var lastScan = 0;
	var lastSpawn = 0;
	var nextSpawnGap = 0;
	var scrollDirty = false;
	var resumeReset = false;

	function rand(min, max) { return min + Math.random() * (max - min); }
	function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
	function pickColour() { return Math.random() < 0.7 ? pick(PRIMARY) : pick(ACCENT); }
	function easeOut(p) { return 1 - Math.pow(1 - p, 3); }

	function targetCount() {
		var n = Math.round((window.innerWidth * window.innerHeight) / 56000);
		return Math.max(8, Math.min(n, 34));
	}

	// Spawn cadence: short gaps while the page is sparse (the opening rush),
	// easing out to long gaps as it approaches the cap.
	function spawnGap() {
		var f = cap > 0 ? Math.min(sprinkles.length / cap, 1) : 1;
		var base = SPAWN_FAST + (SPAWN_SLOW - SPAWN_FAST) * Math.pow(f, 1.6);
		return base * rand(0.85, 1.15);
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

	// Is the point (plus a margin for the capsule's reach) over any content?
	function blocked(x, y, margin) {
		for (var i = 0; i < obstacles.length; i++) {
			var o = obstacles[i];
			if (x >= o.left - margin && x <= o.right + margin &&
				y >= o.top - margin && y <= o.bottom + margin) {
				return true;
			}
		}
		return false;
	}

	// A spot anywhere on screen clear of content; falls back after some tries.
	function freeSpot(margin) {
		for (var i = 0; i < 40; i++) {
			var x = rand(margin, vw - margin);
			var y = rand(margin, vh - margin);
			if (!blocked(x, y, margin)) return { x: x, y: y };
		}
		return { x: rand(margin, vw - margin), y: rand(margin, vh - margin) };
	}

	// The nearest clear spot to a sprinkle's current anchor; keeps moves small.
	function relocate(s) {
		var margin = s.halfW;
		for (var radius = 24; radius <= 240; radius += 24) {
			var start = Math.random() * Math.PI * 2;
			for (var k = 0; k < 16; k++) {
				var a = start + (k / 16) * Math.PI * 2;
				var nx = s.tx + Math.cos(a) * radius;
				var ny = s.ty + Math.sin(a) * radius;
				if (nx < margin || nx > vw - margin || ny < margin || ny > vh - margin) continue;
				if (!blocked(nx, ny, margin)) { s.tx = nx; s.ty = ny; return; }
			}
		}
		var spot = freeSpot(margin);
		s.tx = spot.x;
		s.ty = spot.y;
	}

	function makeSprinkle(now) {
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
		st.background = pickColour();
		st.opacity = '0';
		st.willChange = 'transform, opacity';
		layer.appendChild(el);

		var spot = freeSpot(len / 2);
		return {
			el: el,
			tx: spot.x, ty: spot.y, // resting anchor (target)
			x: spot.x, y: spot.y,   // current position (eases toward target)
			bornAt: now,
			lifespan: rand(LIFE_MIN, LIFE_MAX),
			enterDur: rand(ENTER_MIN, ENTER_MAX),
			startScale: rand(START_SCALE_MIN, START_SCALE_MAX),
			dropY: rand(12, 28), // small vertical drop during the fall-in
			swayPhase: rand(0, Math.PI * 2),
			swaySpeed: rand(0.3, 0.7),
			swayAmpX: rand(1.5, 3.5),
			swayAmpY: rand(2, 4),
			baseAngle: rand(0, 360),
			rotPhase: rand(0, Math.PI * 2),
			rotSpeed: rand(0.2, 0.5),
			rotAmp: rand(3, 8),
			halfW: len / 2,
			halfH: thick / 2
		};
	}

	function removeSprinkle(i) {
		var s = sprinkles[i];
		if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
		sprinkles.splice(i, 1);
	}

	function render(s, now, t) {
		var age = now - s.bornAt;

		// fall-in: large -> resting size, fading and dropping into place
		var p = Math.min(age / s.enterDur, 1);
		var e = easeOut(p);
		var scale = s.startScale + (1 - s.startScale) * e;
		var drop = s.dropY * (1 - e);
		var opacity = TARGET_OPACITY * Math.min(p * 1.4, 1);

		// end of life: recede on Z and fade out before being culled
		if (age > s.lifespan) {
			var x = Math.min((age - s.lifespan) / EXIT_DUR, 1);
			scale = 1 - 0.6 * x;
			drop = 0;
			opacity = TARGET_OPACITY * (1 - x);
		}
		s.el.style.opacity = opacity.toFixed(3);

		var sx = Math.sin(t * s.swaySpeed + s.swayPhase) * s.swayAmpX;
		var sy = Math.cos(t * s.swaySpeed + s.swayPhase * 1.3) * s.swayAmpY;
		var rot = s.baseAngle + Math.sin(t * s.rotSpeed + s.rotPhase) * s.rotAmp;

		s.el.style.transform =
			'translate(' + (s.x + sx - s.halfW).toFixed(2) + 'px,' +
			(s.y + sy - drop - s.halfH).toFixed(2) + 'px) rotate(' +
			rot.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')';
	}

	function frame(now) {
		if (resumeReset) { lastSpawn = now; resumeReset = false; }

		if ((scrollDirty && now - lastScan > SCAN_THROTTLE) ||
			now - lastScan > RESCAN_INTERVAL) {
			refreshObstacles();
			lastScan = now;
			scrollDirty = false;
		}

		// Continuously sprinkle new ones in, up to the current density cap.
		if (sprinkles.length < cap && now - lastSpawn > nextSpawnGap) {
			sprinkles.push(makeSprinkle(now));
			lastSpawn = now;
			nextSpawnGap = spawnGap();
		}

		var t = now / 1000;
		for (var i = sprinkles.length - 1; i >= 0; i--) {
			var s = sprinkles[i];

			// Retire old sprinkles once they've fully faded, freeing a slot.
			if (now - s.bornAt > s.lifespan + EXIT_DUR) {
				removeSprinkle(i);
				continue;
			}

			// Step aside only when content has moved onto the resting spot.
			if (blocked(s.tx, s.ty, s.halfW)) relocate(s);
			s.x += (s.tx - s.x) * EASE;
			s.y += (s.ty - s.y) * EASE;

			// Tidy up any that have ended up fully off the page.
			if (s.x < -s.halfW || s.x > vw + s.halfW ||
				s.y < -s.halfW || s.y > vh + s.halfW) {
				removeSprinkle(i);
				continue;
			}
			render(s, now, t);
		}

		rafId = window.requestAnimationFrame(frame);
	}

	function start() {
		if (rafId !== null) return;
		rafId = window.requestAnimationFrame(frame);
	}

	function stop() {
		if (rafId === null) return;
		window.cancelAnimationFrame(rafId);
		rafId = null;
	}

	// Static placement for visitors who prefer reduced motion (no fall-in).
	function placeStatic() {
		refreshObstacles();
		while (sprinkles.length < cap) sprinkles.push(makeSprinkle(0));
		while (sprinkles.length > cap) removeSprinkle(sprinkles.length - 1);
		for (var i = 0; i < sprinkles.length; i++) {
			var s = sprinkles[i];
			if (blocked(s.tx, s.ty, s.halfW)) relocate(s);
			s.x = s.tx;
			s.y = s.ty;
			s.el.style.opacity = String(TARGET_OPACITY);
			s.el.style.transform =
				'translate(' + (s.x - s.halfW).toFixed(2) + 'px,' +
				(s.y - s.halfH).toFixed(2) + 'px) rotate(' +
				s.baseAngle.toFixed(2) + 'deg)';
		}
	}

	function onResize() {
		vw = window.innerWidth;
		vh = window.innerHeight;
		cap = targetCount();
		refreshObstacles();
		while (sprinkles.length > cap) removeSprinkle(sprinkles.length - 1);
		for (var i = 0; i < sprinkles.length; i++) {
			var s = sprinkles[i];
			s.tx = Math.max(s.halfW, Math.min(s.tx, vw - s.halfW));
			s.ty = Math.max(s.halfW, Math.min(s.ty, vh - s.halfW));
		}
		if (reduceMotion) placeStatic();
	}

	function init() {
		if (layer) return;
		vw = window.innerWidth;
		vh = window.innerHeight;
		cap = targetCount();
		makeLayer();
		refreshObstacles();

		window.addEventListener('resize', onResize);

		if (reduceMotion) {
			placeStatic();
			return;
		}

		nextSpawnGap = spawnGap();
		window.addEventListener('scroll', function () { scrollDirty = true; }, { passive: true });
		document.addEventListener('visibilitychange', function () {
			if (document.hidden) { stop(); }
			else { resumeReset = true; start(); }
		});

		start();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
