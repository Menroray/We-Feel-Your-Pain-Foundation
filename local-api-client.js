(function () {
  var authListeners = [];

  async function request(url, options) {
    var response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
    var body = null;
    try { body = await response.json(); } catch (error) { body = null; }
    if (!response.ok) throw new Error(body && body.error ? body.error : 'Local server request failed (' + response.status + ').');
    return body;
  }

  function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  function Query(table) {
    this.table = table;
    this.operation = 'select';
    this.values = null;
    this.filters = [];
    this.ordering = null;
  }

  Query.prototype.select = function () { this.operation = 'select'; return this; };
  Query.prototype.insert = function (values) { this.operation = 'insert'; this.values = values; return this; };
  Query.prototype.update = function (values) { this.operation = 'update'; this.values = values; return this; };
  Query.prototype.delete = function () { this.operation = 'delete'; return this; };
  Query.prototype.upsert = function (values) { this.operation = 'upsert'; this.values = values; return this; };
  Query.prototype.eq = function (key, value) { this.filters.push([key, value]); return this; };
  Query.prototype.order = function (column, options) {
    this.ordering = column + '.' + (options && options.ascending === false ? 'desc' : 'asc');
    return this;
  };
  Query.prototype.execute = async function () {
    try {
      var url = '/api/' + encodeURIComponent(this.table);
      var options = {};
      if (this.operation === 'select') {
        var params = new URLSearchParams();
        this.filters.forEach(function (filter) {
          params.set(filter[0], 'eq.' + (typeof filter[1] === 'boolean' ? String(filter[1]) : filter[1]));
        });
        if (this.ordering) params.set('order', this.ordering);
        if (params.size) url += '?' + params.toString();
        options.method = 'GET';
      } else if (this.operation === 'insert' || this.operation === 'upsert') {
        options.method = 'POST';
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(this.operation === 'upsert'
          ? { records: this.values, upsert: true }
          : this.values);
      } else if (this.operation === 'update' || this.operation === 'delete') {
        var idFilter = this.filters.find(function (filter) { return filter[0] === 'id'; });
        if (!idFilter) throw new Error('A record ID is required for this change.');
        url += '/' + encodeURIComponent(idFilter[1]);
        options.method = this.operation === 'update' ? 'PATCH' : 'DELETE';
        if (this.operation === 'update') {
          options.headers = { 'Content-Type': 'application/json' };
          options.body = JSON.stringify(this.values);
        }
      }
      return { data: await request(url, options), error: null };
    } catch (error) {
      return { data: null, error: { message: error.message } };
    }
  };
  Query.prototype.then = function (resolve, reject) { return this.execute().then(resolve, reject); };

  var api = {
    from: function (table) { return new Query(table); },
    auth: {
      onAuthStateChange: function (callback) {
        authListeners.push(callback);
        return { data: { subscription: { unsubscribe: function () {
          authListeners = authListeners.filter(function (listener) { return listener !== callback; });
        } } } };
      },
      getSession: async function () {
        try {
          var result = await request('/api/session');
          return { data: { session: result.user ? { user: result.user } : null }, error: null };
        } catch (error) {
          return { data: { session: null }, error: { message: error.message } };
        }
      },
      signInWithPassword: async function (credentials) {
        try {
          var result = await request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials)
          });
          authListeners.forEach(function (listener) { listener('SIGNED_IN', { user: result.user }); });
          return { data: result, error: null };
        } catch (error) {
          return { data: null, error: { message: error.message } };
        }
      },
      signOut: async function () {
        try {
          await request('/api/auth/logout', { method: 'POST' });
          authListeners.forEach(function (listener) { listener('SIGNED_OUT', null); });
          return { error: null };
        } catch (error) {
          return { error: { message: error.message } };
        }
      }
    },
    storage: {
      from: function (bucket) {
        return {
          getPublicUrl: function (path) {
            return { data: { publicUrl: '/uploads/' + encodePath(path) } };
          },
          upload: async function (path, file) {
            try {
              var form = new FormData();
              form.append('file', file, file.name);
              var result = await request('/api/storage/' + encodeURIComponent(bucket) + '/upload?path=' + encodeURIComponent(path), {
                method: 'POST', body: form
              });
              return { data: result, error: null };
            } catch (error) {
              return { data: null, error: { message: error.message } };
            }
          },
          remove: async function (paths) {
            try {
              var params = new URLSearchParams();
              paths.forEach(function (path) { params.append('path', path); });
              var result = await request('/api/storage/' + encodeURIComponent(bucket) + '/object?' + params.toString(), { method: 'DELETE' });
              return { data: result.removed, error: null };
            } catch (error) {
              return { data: null, error: { message: error.message } };
            }
          }
        };
      }
    }
  };

  window.wfypLocalApi = api;
})();