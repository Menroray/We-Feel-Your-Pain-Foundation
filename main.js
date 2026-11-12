/* We Feel Your Pain Global Foundation — shared behaviour */
(function () {
  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  /* ---- Desktop "Menu" dropdown ---- */
  var menuBtn = document.getElementById('menuBtn');
  var menuPanel = document.getElementById('menuPanel');
  function setMenu(open) {
    if (!menuBtn || !menuPanel) return;
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuPanel.classList.toggle('open', open);
  }
  if (menuBtn) {
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setMenu(menuBtn.getAttribute('aria-expanded') !== 'true');
    });
    document.addEventListener('click', function (e) {
      if (!menuPanel.contains(e.target)) setMenu(false);
    });
  }

  /* ---- Mobile burger ---- */
  var burger = document.getElementById('burger');
  var nav = document.getElementById('mainNav');
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = burger.getAttribute('aria-expanded') !== 'true';
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      nav.classList.toggle('open', open);
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      setMenu(false);
      closeLightbox();
      if (burger && nav) { burger.setAttribute('aria-expanded', 'false'); nav.classList.remove('open'); }
    }
  });

  /* ---- Scroll reveal ---- */
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---- Leadership slider: clone the set so the loop is seamless ---- */
  var track = document.getElementById('slideTrack');
  if (track) {
    var originals = Array.prototype.slice.call(track.children);
    for (var i = 0; i < 2; i++) {
      originals.forEach(function (node) {
        var c = node.cloneNode(true);
        c.setAttribute('aria-hidden', 'true');
        track.appendChild(c);
      });
    }
  }

  /* ---- Lightbox (impact gallery) ---- */
  var lb = document.getElementById('lightbox');
  var lbImg = lb ? lb.querySelector('img') : null;
  function closeLightbox() { if (lb) lb.classList.remove('open'); }
  if (lb) {
    document.querySelectorAll('[data-zoom]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var img = btn.querySelector('img');
        lbImg.src = img.currentSrc || img.src;
        lbImg.alt = img.alt;
        lb.classList.add('open');
      });
    });
    lb.addEventListener('click', function (e) { if (e.target !== lbImg) closeLightbox(); });
  }

  /* ---- Contact form -> opens the visitor's email app (no server needed) ---- */
  var form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = new FormData(form);
      var body = 'Name: ' + d.get('name') + '\nEmail: ' + d.get('email') +
        '\nPhone: ' + (d.get('phone') || '-') + '\n\n' + d.get('message');
      window.location.href = 'mailto:wefeelyourpainglobalfoundation@gmail.com' +
        '?subject=' + encodeURIComponent(d.get('topic') + ' — ' + d.get('name')) +
        '&body=' + encodeURIComponent(body);
    });
  }

  /* ---- Footer year ---- */
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
