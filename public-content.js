(function () {
  var client = window.wfypLocalApi;
  if (!client) return;

  var pageSlug = window.location.pathname.split('/').pop().replace(/\.html$/, '') || 'index';
  if (pageSlug === 'administration') return;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function publishedRecords(table, orderColumn, ascending) {
    var query = client.from(table).select('*').eq('published', true);
    if (orderColumn) query = query.order(orderColumn, { ascending: Boolean(ascending) });
    var result = await query;
    if (result.error) throw result.error;
    return result.data || [];
  }

  function formatDate(value) {
    if (!value) return '';
    return new Date(value + 'T00:00:00').toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  async function renderEvents() {
    var container = document.getElementById('cmsEvents');
    if (!container) return;
    try {
      var records = await publishedRecords('events', 'event_date', true);
      records = records.filter(function (record) { return record.status === 'Upcoming'; });
      if (!records.length) return;
      container.replaceChildren();
      records.forEach(function (record) {
        var card = element('article', 'card');
        var meta = [formatDate(record.event_date), record.location].filter(Boolean).join(' · ');
        if (meta) card.appendChild(element('span', 'tag', meta));
        card.appendChild(element('h3', '', record.title));
        if (record.summary) card.appendChild(element('p', '', record.summary));
        container.appendChild(card);
      });
      var empty = document.getElementById('eventsEmptyState');
      if (empty) empty.hidden = true;
    } catch (error) {
      console.error('Could not load published events.', error);
    }
  }

  function makePhotoButton(record) {
    var button = element('button', 'shot');
    button.type = 'button';
    button.dataset.cmsPhoto = 'true';
    button.setAttribute('aria-label', 'Enlarge photo: ' + record.title);
    var image = element('img');
    image.src = record.image_url;
    image.alt = record.alt_text || record.title;
    image.loading = 'lazy';
    button.appendChild(image);
    button.appendChild(element('span', 'media-caption', record.description || record.title));
    return button;
  }

  async function renderImpact() {
    var galleries = [document.getElementById('impactGallery'), document.getElementById('homeImpactGallery')].filter(Boolean);
    if (!galleries.length) return;
    try {
      var results = await Promise.all([
        publishedRecords('impact_stories', 'story_date', false),
        publishedRecords('media_assets', 'sort_order', true)
      ]);
      var records = results[0].filter(function (record) { return Boolean(record.image_url); }).map(function (record) {
        return { title: record.title, alt_text: record.title, description: record.summary, image_url: record.image_url, media_type: 'image' };
      });
      results[1].forEach(function (record) {
        records.push({
          title: record.title,
          alt_text: record.alt_text,
          description: record.description,
          media_type: record.media_type,
          image_url: client.storage.from('foundation-media').getPublicUrl(record.file_path).data.publicUrl
        });
      });
      if (!records.length) return;
      galleries.forEach(function (gallery) {
        gallery.replaceChildren();
        records.forEach(function (record) {
          if (record.media_type === 'video') {
            var figure = element('figure', 'media-video');
            var video = element('video');
            video.src = record.image_url;
            video.controls = true;
            video.preload = 'metadata';
            video.playsInline = true;
            video.setAttribute('aria-label', record.title);
            figure.appendChild(video);
            figure.appendChild(element('figcaption', '', record.title));
            if (record.description) figure.appendChild(element('p', '', record.description));
            gallery.appendChild(figure);
          } else {
            gallery.appendChild(makePhotoButton(record));
          }
        });
      });
    } catch (error) {
      console.error('Could not load published impact stories.', error);
    }
  }

  async function renderLeadership() {
    var track = document.getElementById('slideTrack');
    if (!track) return;
    try {
      var records = await publishedRecords('leadership', 'sort_order', true);
      if (!records.length) return;
      track.replaceChildren();
      records.forEach(function (record) {
        var figure = element('figure', 'leader');
        figure.style.margin = '0';
        var photo = element('div', 'ph');
        if (record.image_url) {
          var image = element('img');
          image.src = record.image_url;
          image.alt = 'Portrait of ' + record.name;
          image.loading = 'lazy';
          photo.appendChild(image);
        }
        figure.appendChild(photo);
        figure.appendChild(element('h3', '', record.name));
        if (record.role) figure.appendChild(element('p', 'leader-role', record.role));
        track.appendChild(figure);
      });
      var originals = Array.prototype.slice.call(track.children);
      for (var copy = 0; copy < 2; copy++) {
        originals.forEach(function (node) {
          var clone = node.cloneNode(true);
          clone.setAttribute('aria-hidden', 'true');
          track.appendChild(clone);
        });
      }
    } catch (error) {
      console.error('Could not load published leadership profiles.', error);
    }
  }

  async function renderDonations() {
    var containers = Array.prototype.slice.call(document.querySelectorAll('[data-cms-donations]'));
    if (!containers.length) return;
    try {
      var records = await publishedRecords('donation_options', 'sort_order', true);
      if (!records.length) return;
      containers.forEach(function (container) {
        container.replaceChildren();
        records.forEach(function (record, index) {
          var card = element('article', 'card give');
          card.appendChild(element('span', 'num', String(index + 1).padStart(2, '0')));
          card.appendChild(element('h3', '', record.title));
          if (record.description) card.appendChild(element('p', '', record.description));
          if (record.details) card.appendChild(element('p', 'managed-donation-details', record.details));
          var link = element('a', 'btn btn-dark', 'Get started');
          link.href = 'contact.html?topic=' + encodeURIComponent(record.title);
          card.appendChild(link);
          container.appendChild(card);
        });
        var contactCard = element('article', 'card');
        contactCard.appendChild(element('h3', '', 'Need help choosing?'));
        contactCard.appendChild(element('p', '', 'Contact the Foundation to discuss a giving option.'));
        var contactLink = element('a', 'btn btn-ghost', 'Contact us');
        contactLink.href = 'contact.html';
        contactCard.appendChild(contactLink);
        container.appendChild(contactCard);
      });
      var placeholder = document.getElementById('donationPlaceholder');
      if (placeholder) placeholder.hidden = true;
    } catch (error) {
      console.error('Could not load published donation options.', error);
    }
  }

  async function renderPageContent() {
    var main = document.querySelector('main');
    if (!main) return;
    try {
      var result = await client.from('page_content').select('*').eq('page_slug', pageSlug).eq('published', true).order('created_at', { ascending: true });
      if (result.error) throw result.error;
      if (!result.data || !result.data.length) return;
      var section = element('section', 'managed-content');
      var wrap = element('div', 'wrap');
      var heading = element('div', 'sec-head');
      heading.appendChild(element('span', 'tag', 'From the Foundation'));
      heading.appendChild(element('h2', '', 'More information'));
      wrap.appendChild(heading);
      var grid = element('div', 'grid g-2');
      result.data.forEach(function (record) {
        var card = element('article', 'card');
        if (record.section_key) card.appendChild(element('span', 'tag', record.section_key.replace(/[-_]/g, ' ')));
        card.appendChild(element('h3', '', record.title));
        if (record.body) card.appendChild(element('p', '', record.body));
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
      section.appendChild(wrap);
      var lastSection = main.querySelector('section:last-of-type');
      if (lastSection) main.insertBefore(section, lastSection);
      else main.appendChild(section);
      var placeholder = main.querySelector('[data-cms-page-placeholder="' + pageSlug + '"]');
      if (placeholder) placeholder.hidden = true;
    } catch (error) {
      console.error('Could not load published page content.', error);
    }
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-cms-photo]');
    if (!button) return;
    var lightbox = document.getElementById('lightbox');
    var image = lightbox && lightbox.querySelector('img');
    var source = button.querySelector('img');
    if (!image || !source) return;
    image.src = source.currentSrc || source.src;
    image.alt = source.alt;
    lightbox.classList.add('open');
  });

  renderEvents();
  renderImpact();
  renderLeadership();
  renderDonations();
  renderPageContent();
})();