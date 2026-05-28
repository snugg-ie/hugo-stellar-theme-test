function set_theme() {
	if (localStorage['theme']) {
		document.getElementById('main').classList.add('force-theme-' + localStorage['theme']);
		document.body.classList.add('force-theme-' + localStorage['theme']);
		if (document.getElementById("nav")) {
			document.getElementById('nav').classList.add('force-theme-' + localStorage['theme']);
		}
	}

	//   if (localStorage['theme'] === 'dark') {
	// 	  document.getElementById('avatar').src='https://github.com/Snuggle.png'
	//   } else {
	// 	  document.getElementById('avatar').src='https://github.com/Snuggle.png'
	//   }
}

function reset_theme() {
	localStorage.removeItem('theme');
	document.getElementById('main').classList.forEach(className => {
		if (className.startsWith('force-theme-')) {
			document.getElementById('main').classList.remove(className);
		}
	});

	localStorage.removeItem('theme');
	document.querySelector('body').classList.forEach(className => {
		if (className.startsWith('force-theme-')) {
			document.querySelector('body').classList.remove(className);
		}
	});

	if (document.getElementById("nav")) {
		[...document.getElementById('nav').classList].forEach(className => {
			if (className.startsWith('force-theme-')) {
				document.getElementById('nav').classList.remove(className);
			}
		});
	}


}

function toggle_theme(theme) {
	reset_theme();
	localStorage['theme'] = theme;
	set_theme();
}

set_theme();