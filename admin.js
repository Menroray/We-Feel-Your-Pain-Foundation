(function () {
  var client = window.wfypLocalApi;
  var collectionDefinitions = {
    events: {
      label: 'Events',
      addLabel: 'Add event',
      table: 'events',
      titleKey: 'title',
      metaKeys: ['event_date', 'location', 'status'],
      summaryKey: 'summary',
      fields: [
        { key: 'title', label: 'Event title', type: 'text', required: true },
        { key: 'event_date', label: 'Date', type: 'date' },
        { key: 'location', label: 'Location', type: 'text' },
        { key: 'status', label: 'Status', type: 'select', options: ['Upcoming', 'Completed', 'Draft'] },
        { key: 'summary', label: 'Summary', type: 'textarea', full: true },
        { key: 'published', label: 'Publish this event', type: 'checkbox', full: true }
      ]
    },
    impact: {
      label: 'Impact stories',
      addLabel: 'Add impact story',
      table: 'impact_stories',
      titleKey: 'title',
      metaKeys: ['story_date', 'location'],
      summaryKey: 'summary',
      fields: [
        { key: 'title', label: 'Story title', type: 'text', required: true },
        { key: 'story_date', label: 'Date', type: 'date' },
        { key: 'location', label: 'Location', type: 'text' },
        { key: 'image_url', label: 'Photo URL', type: 'url', full: true },
        { key: 'summary', label: 'Story', type: 'textarea', full: true },
        { key: 'published', label: 'Publish this story', type: 'checkbox', full: true }
      ]
    },
    leadership: {
      label: 'Leadership',
      addLabel: 'Add leadership profile',
      table: 'leadership',
      titleKey: 'name',
      metaKeys: ['role', 'sort_order'],
      summaryKey: 'bio',
      fields: [
        { key: 'name', label: 'Full name', type: 'text', required: true },
        { key: 'role', label: 'Position', type: 'text', required: true },
        { key: 'image_url', label: 'Portrait URL', type: 'url', full: true },
        { key: 'bio', label: 'Biography', type: 'textarea', full: true },
        { key: 'sort_order', label: 'Display order', type: 'number' },
        { key: 'published', label: 'Publish this profile', type: 'checkbox' }
      ]
    },
    pages: {
      label: 'Page content',
      addLabel: 'Add page content',
      table: 'page_content',
      titleKey: 'title',
      metaKeys: ['page_slug', 'section_key'],
      summaryKey: 'body',
      fields: [
        { key: 'page_slug', label: 'Page', type: 'select', required: true, options: [
          { label: 'Home', value: 'index' }, { label: 'About', value: 'about' },
          { label: 'Impact Programs', value: 'impact' }, { label: 'Events', value: 'events' },
          { label: 'Donate', value: 'donate' }, { label: 'Donation', value: 'donation' },
          { label: 'Leadership', value: 'leadership' }, { label: 'Administration', value: 'administration' },
          { label: 'Volunteer', value: 'volunteer' }, { label: 'Contact', value: 'contact' }
        ] },
        { key: 'section_key', label: 'Section name', type: 'text', required: true },
        { key: 'title', label: 'Heading', type: 'text', required: true, full: true },
        { key: 'body', label: 'Content', type: 'textarea', full: true },
        { key: 'published', label: 'Publish this content', type: 'checkbox', full: true }
      ]
    },
    donations: {
      label: 'Donations',
      addLabel: 'Add giving option',
      table: 'donation_options',
      titleKey: 'title',
      metaKeys: ['donation_type', 'sort_order'],
      summaryKey: 'description',
      fields: [
        { key: 'title', label: 'Giving option', type: 'text', required: true },
        { key: 'donation_type', label: 'Type', type: 'select', options: ['One-time', 'Monthly', 'Sponsorship', 'Medical outreach', 'Education', 'Assistive devices', 'Corporate partnership', 'In-kind'] },
        { key: 'description', label: 'Description', type: 'textarea', full: true },
        { key: 'details', label: 'Contact or payment details', type: 'textarea', full: true },
        { key: 'sort_order', label: 'Display order', type: 'number' },
        { key: 'published', label: 'Publish this option', type: 'checkbox' }
      ]
    },
    media: {
      label: 'Media library',
      addLabel: 'Add photo or video',
      table: 'media_assets',
      titleKey: 'title',
      metaKeys: ['media_type', 'sort_order'],
      summaryKey: 'description',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'media_type', label: 'Media type', type: 'select', required: true, options: [
          { label: 'Photo or image', value: 'image' }, { label: 'Video', value: 'video' }
        ] },
        { key: 'file', label: 'Choose a file', type: 'file', required: true, full: true, accept: 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime', help: 'JPEG, PNG, WebP, GIF, MP4, WebM, or MOV. Maximum file size: 50 MB.' },
        { key: 'alt_text', label: 'Image description', type: 'text', full: true },
        { key: 'description', label: 'Caption or context', type: 'textarea', full: true },
        { key: 'sort_order', label: 'Display order', type: 'number' },
        { key: 'published', label: 'Publish this media', type: 'checkbox' }
      ]
    }
  };

  var collections = Object.keys(collectionDefinitions);
  var data = createEmptyData();
  var activeCollection = collections[0];
  var editingId = null;
  var toastTimer = null;
  var collectionNav = document.getElementById('adminCollections');
  var list = document.getElementById('adminList');
  var count = document.getElementById('adminCount');
  var search = document.getElementById('adminSearch');
  var dialog = document.getElementById('recordDialog');
  var form = document.getElementById('recordForm');
  var fieldsContainer = document.getElementById('recordFields');
  var toast = document.getElementById('adminToast');

  if (!collectionNav || !list || !dialog || !form) return;

  function createEmptyData() {
    return { events: [], impact: [], leadership: [], pages: [], donations: [], media: [] };
  }

  function notify(message, isError) {
    toast.textContent = message;
    toast.classList.toggle('error', Boolean(isError));
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.classList.remove('show'); }, 3200);
  }

  async function loadData() {
    var results = await Promise.all(collections.map(function (key) {
      var definition = collectionDefinitions[key];
      return client.from(definition.table).select('*').order('created_at', { ascending: false });
    }));
    results.forEach(function (result, index) {
      if (result.error) throw result.error;
      data[collections[index]] = result.data || [];
    });
  }

  function makeElement(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeButton(text, action, id) {
    var button = makeElement('button', '', text);
    button.type = 'button';
    button.dataset.action = action;
    button.dataset.id = id;
    return button;
  }

  function renderCollections() {
    collectionNav.replaceChildren();
    collections.forEach(function (key) {
      var button = makeElement('button', 'admin-collection');
      button.type = 'button';
      button.dataset.collection = key;
      button.setAttribute('aria-pressed', key === activeCollection ? 'true' : 'false');
      button.appendChild(document.createTextNode(collectionDefinitions[key].label));
      button.appendChild(makeElement('span', 'admin-collection-count', String(data[key].length)));
      collectionNav.appendChild(button);
    });
  }

  function getTitle(record, definition) {
    return record[definition.titleKey] || 'Untitled record';
  }

  function renderRecords() {
    var definition = collectionDefinitions[activeCollection];
    var query = search.value.trim().toLowerCase();
    var records = data[activeCollection].filter(function (record) {
      return !query || JSON.stringify(record).toLowerCase().includes(query);
    });
    count.textContent = records.length + (records.length === 1 ? ' record' : ' records') +
      (query ? ' matching your search' : ' in ' + definition.label.toLowerCase());
    list.replaceChildren();

    if (records.length === 0) {
      var empty = makeElement('div', 'admin-empty');
      empty.appendChild(makeElement('strong', '', query ? 'No matching records' : 'No records yet'));
      empty.appendChild(makeElement('span', '', query ? 'Try another search.' : 'Add a record to start this collection.'));
      list.appendChild(empty);
      return;
    }

    records.forEach(function (record) {
      var row = makeElement('article', 'admin-row' + (activeCollection === 'media' ? ' admin-row-media' : ''));
      var content = makeElement('div');
      if (activeCollection === 'media') {
        if (record.media_type === 'image') {
          var preview = makeElement('img', 'admin-media-thumb');
          preview.src = client.storage.from('foundation-media').getPublicUrl(record.file_path).data.publicUrl;
          preview.alt = record.alt_text || record.title;
          row.appendChild(preview);
        } else {
          row.appendChild(makeElement('span', 'admin-media-thumb admin-video-thumb', 'Video'));
        }
      }
      content.appendChild(makeElement('div', 'admin-record-title', getTitle(record, definition)));
      var meta = makeElement('div', 'admin-record-meta');
      definition.metaKeys.forEach(function (key) {
        if (record[key]) meta.appendChild(makeElement('span', '', record[key]));
      });
      meta.appendChild(makeElement('span', 'admin-record-status ' + (record.published ? 'is-published' : ''), record.published ? 'Published' : 'Draft'));
      if (meta.childNodes.length) content.appendChild(meta);
      if (record[definition.summaryKey]) {
        content.appendChild(makeElement('div', 'admin-record-summary', record[definition.summaryKey]));
      }
      var actions = makeElement('div', 'admin-row-actions');
      actions.appendChild(makeButton('Edit', 'edit', record.id));
      actions.appendChild(makeButton('Delete', 'delete', record.id));
      row.appendChild(content);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function render() {
    renderCollections();
    renderRecords();
    document.getElementById('addRecord').textContent = collectionDefinitions[activeCollection].addLabel;
  }

  function renderField(field, value, isEditing) {
    var wrapper = makeElement('div', 'admin-field' + (field.full ? ' admin-field-full' : ''));
    var id = 'record-' + field.key;
    var input = document.createElement(field.type === 'textarea' ? 'textarea' : field.type === 'select' ? 'select' : 'input');
    input.id = id;
    input.name = field.key;
    input.required = Boolean(field.required && !(field.type === 'file' && isEditing));
    if (field.type !== 'textarea' && field.type !== 'select') input.type = field.type;
    if (field.type === 'file') {
      input.accept = field.accept || '';
      var fileLabel = makeElement('label', '', field.label);
      fileLabel.htmlFor = id;
      wrapper.appendChild(fileLabel);
      wrapper.appendChild(input);
      if (field.help) wrapper.appendChild(makeElement('small', 'admin-field-help', field.help));
      return wrapper;
    }
    if (field.type === 'checkbox') {
      input.checked = Boolean(value);
      var checkboxLabel = makeElement('label', 'admin-checkbox');
      checkboxLabel.appendChild(input);
      checkboxLabel.appendChild(makeElement('span', '', field.label));
      wrapper.appendChild(checkboxLabel);
      return wrapper;
    }
    var label = makeElement('label', '', field.label);
    label.htmlFor = id;
    if (field.type === 'select') {
      field.options.forEach(function (option) {
        var optionLabel = typeof option === 'string' ? option : option.label;
        var optionValue = typeof option === 'string' ? option : option.value;
        var optionElement = makeElement('option', '', optionLabel);
        optionElement.value = optionValue;
        input.appendChild(optionElement);
      });
    }
    if (value !== undefined && value !== null) input.value = value;
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return wrapper;
  }

  function openForm(record) {
    var definition = collectionDefinitions[activeCollection];
    editingId = record ? record.id : null;
    document.getElementById('dialogCollection').textContent = definition.label;
    document.getElementById('dialogTitle').textContent = record ? 'Edit record' : 'Add record';
    fieldsContainer.replaceChildren();
    definition.fields.forEach(function (field) {
      fieldsContainer.appendChild(renderField(field, record ? record[field.key] : '', Boolean(record)));
    });
    if (record && activeCollection === 'media') {
      var currentFile = makeElement('a', 'admin-current-file', 'View current file');
      currentFile.href = client.storage.from('foundation-media').getPublicUrl(record.file_path).data.publicUrl;
      currentFile.target = '_blank';
      currentFile.rel = 'noopener noreferrer';
      fieldsContainer.appendChild(currentFile);
    }
    dialog.showModal();
    var firstField = fieldsContainer.querySelector('input, select, textarea');
    if (firstField) firstField.focus();
  }

  function createId() {
    return window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function makeMediaPath(file) {
    var fileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || 'upload';
    return 'media/' + createId() + '-' + fileName;
  }

  function exportBackup() {
    var backup = { version: 3, exportedAt: new Date().toISOString(), collections: data };
    var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = makeElement('a');
    link.href = url;
    link.download = 'wfyp-content-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    notify('Backup exported. Keep the JSON file somewhere safe.');
  }

  async function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      (async function () {
       try {
        var backup = JSON.parse(reader.result);
        var imported = backup && backup.collections;
        if (!backup || backup.version !== 3 || !imported || collections.some(function (key) {
          return !Array.isArray(imported[key]) || imported[key].some(function (record) {
            return !record || typeof record !== 'object' || typeof record.id !== 'string';
          });
        })) {
          throw new Error('This file is not a valid Foundation content backup.');
        }
        if (!window.confirm('Import these records into the local database? Matching IDs will be updated.')) return;
        for (var i = 0; i < collections.length; i++) {
          var key = collections[i];
          if (!imported[key].length) continue;
          var result = await client.from(collectionDefinitions[key].table).upsert(imported[key], { onConflict: 'id' });
          if (result.error) throw result.error;
        }
        await loadData();
        render();
        notify('Backup imported successfully.');
       } catch (error) {
        notify(error.message || 'Could not read this backup file.', true);
       }
      })();
    };
    reader.onerror = function () { notify('Could not read this backup file.', true); };
    reader.readAsText(file);
  }

  collectionNav.addEventListener('click', function (event) {
    var button = event.target.closest('[data-collection]');
    if (!button) return;
    activeCollection = button.dataset.collection;
    search.value = '';
    render();
  });

  list.addEventListener('click', async function (event) {
    var button = event.target.closest('[data-action]');
    if (!button) return;
    var record = data[activeCollection].find(function (item) { return item.id === button.dataset.id; });
    if (!record) return;
    var filePath = activeCollection === 'media' ? record.file_path : null;
    if (button.dataset.action === 'edit') {
      openForm(record);
      return;
    }
    if (button.dataset.action === 'delete' && window.confirm('Delete "' + getTitle(record, collectionDefinitions[activeCollection]) + '"?')) {
      try {
        var result = await client.from(collectionDefinitions[activeCollection].table).delete().eq('id', record.id);
        if (result.error) throw result.error;
        var storageWarning = false;
        if (filePath) {
          var storageResult = await client.storage.from('foundation-media').remove([filePath]);
          storageWarning = Boolean(storageResult.error);
        }
        try {
          await loadData();
          render();
        } catch (refreshError) {
          notify('Record deleted, but the list could not be refreshed. Reload the page.', true);
          return;
        }
        if (storageWarning) {
          notify('Record deleted, but its media file could not be removed.', true);
          return;
        }
        notify('Record deleted.');
      } catch (error) {
        notify(error.message || 'Could not delete this record.', true);
      }
    }
  });

  document.getElementById('addRecord').addEventListener('click', function () { openForm(null); });
  search.addEventListener('input', renderRecords);
  document.getElementById('exportBackup').addEventListener('click', exportBackup);
  document.getElementById('importBackupButton').addEventListener('click', function () {
    document.getElementById('importBackup').click();
  });
  document.getElementById('importBackup').addEventListener('change', function (event) {
    if (event.target.files && event.target.files[0]) importBackup(event.target.files[0]);
    event.target.value = '';
  });

  document.querySelectorAll('[data-close-dialog]').forEach(function (button) {
    button.addEventListener('click', function () { dialog.close(); });
  });
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close();
  });
  var saveButton = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    var values = {};
    var selectedFile = null;
    collectionDefinitions[activeCollection].fields.forEach(function (field) {
      var control = form.elements.namedItem(field.key);
      if (field.type === 'file') selectedFile = control.files[0] || null;
      else if (field.type === 'checkbox') values[field.key] = control.checked;
      else if (field.type === 'number') values[field.key] = control.value ? Number(control.value) : 0;
      else if (field.type === 'date') values[field.key] = control.value || null;
      else values[field.key] = control.value.trim();
    });
    var uploadedPath = null;
    var previousMedia = activeCollection === 'media' && editingId
      ? data.media.find(function (record) { return record.id === editingId; })
      : null;
    var previousFilePath = previousMedia ? previousMedia.file_path : null;
    try {
      var table = collectionDefinitions[activeCollection].table;
      if (previousMedia && !selectedFile && values.media_type !== previousMedia.media_type) {
        throw new Error('Choose a replacement file to change the media type.');
      }
      if (activeCollection === 'media' && selectedFile) {
        var supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];
        var expectedType = selectedFile.type.indexOf('video/') === 0 ? 'video' : 'image';
        if (selectedFile.size > 52428800) throw new Error('Choose a file smaller than 50 MB.');
        if (supportedTypes.indexOf(selectedFile.type) === -1) throw new Error('This image or video format is not supported.');
        if (values.media_type !== expectedType) throw new Error('Choose a file that matches the selected media type.');
        uploadedPath = makeMediaPath(selectedFile);
        var uploadResult = await client.storage.from('foundation-media').upload(uploadedPath, selectedFile, {
          cacheControl: '3600',
          contentType: selectedFile.type,
          upsert: false
        });
        if (uploadResult.error) throw uploadResult.error;
        values.file_path = uploadedPath;
      }
      var result = editingId
        ? await client.from(table).update(values).eq('id', editingId)
        : await client.from(table).insert(values);
      if (result.error) throw result.error;
      var wasEditing = Boolean(editingId);
      dialog.close();
      editingId = null;
      var cleanupWarning = false;
      if (previousFilePath && uploadedPath && previousFilePath !== uploadedPath) {
        var cleanupResult = await client.storage.from('foundation-media').remove([previousFilePath]);
        cleanupWarning = Boolean(cleanupResult.error);
      }
      try {
        await loadData();
        render();
      } catch (refreshError) {
        notify('Record saved, but the list could not be refreshed. Reload the page.', true);
        return;
      }
      if (cleanupWarning) {
        notify('Record saved, but the previous media file could not be removed.', true);
        return;
      }
      notify(wasEditing ? 'Record updated.' : 'Record created.');
    } catch (error) {
      if (uploadedPath) {
        var cleanupResult = await client.storage.from('foundation-media').remove([uploadedPath]);
        if (cleanupResult.error) console.warn('Could not remove failed upload.', cleanupResult.error);
      }
      notify(error.message || 'Could not save this record.', true);
    } finally {
      saveButton.disabled = false;
    }
  });

  var loginPanel = document.getElementById('adminLoginPanel');
  var loginForm = document.getElementById('adminLoginForm');
  var loginStatus = document.getElementById('adminLoginStatus');
  var setupNotice = document.getElementById('adminSetupNotice');
  var manager = document.getElementById('adminManager');
  var emailLabel = document.getElementById('adminEmail');

  async function showAdmin(user) {
    if (!user || !user.app_metadata || user.app_metadata.role !== 'admin') {
      loginStatus.textContent = 'This account does not have administrator access.';
      await client.auth.signOut();
      return;
    }
    loginPanel.hidden = true;
    manager.hidden = false;
    emailLabel.textContent = user.email || '';
    try {
      await loadData();
      render();
    } catch (error) {
      manager.hidden = true;
      loginPanel.hidden = false;
      loginStatus.textContent = error.message || 'Could not load content from the local database.';
    }
  }

  if (!client) {
    loginPanel.hidden = true;
    setupNotice.hidden = false;
    setupNotice.textContent = 'The local backend is unavailable. Start it with “python server.py” from the project folder, then reload this page.';
  } else {
    client.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') {
        manager.hidden = true;
        loginPanel.hidden = false;
        loginForm.reset();
      }
    });

    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      loginStatus.textContent = 'Signing in…';
      var credentials = new FormData(loginForm);
      var result = await client.auth.signInWithPassword({
        email: credentials.get('email'),
        password: credentials.get('password')
      });
      if (result.error) {
        loginStatus.textContent = result.error.message;
        return;
      }
      await showAdmin(result.data.user);
    });

    document.getElementById('adminSignOut').addEventListener('click', async function () {
      var result = await client.auth.signOut();
      if (result.error) notify(result.error.message, true);
    });

    client.auth.getSession().then(function (result) {
      if (result.error) {
        loginStatus.textContent = result.error.message;
        return;
      }
      if (result.data.session) showAdmin(result.data.session.user);
    });
  }
})();