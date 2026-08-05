/* Publish page: paste a repo link → autofill → checklist → open a pre-filled
   GitHub "create new file" page, which GitHub turns into a pull request.
   No backend anywhere: one user-initiated GitHub API call for autofill. */
(function () {
  'use strict';

  var form = document.getElementById('publish-form');
  if (!form) return;
  var registry = form.getAttribute('data-registry'); // "owner/repo"
  var branch = form.getAttribute('data-branch') || 'main';
  var registryReady = registry && registry.indexOf('YOUR_GITHUB_USERNAME') === -1;

  var $ = function (id) { return document.getElementById(id); };
  var fields = {
    repo: $('f-repo'), name: $('f-name'), tagline: $('f-tagline'),
    description: $('f-description'), icon: $('f-icon'), website: $('f-website'),
    download: $('f-download'), tags: $('f-tags'), screenshots: $('f-screenshots'),
  };

  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ---------- checklist ---------- */
  var checks = { repo: null, license: null, apk: null, free: null };
  var detectedLicense = '';

  function drawChecks() {
    var list = $('checklist');
    if (!list) return;
    var rows = [
      ['repo', 'We can see your app’s page on GitHub'],
      ['license', 'It has an open-source license'],
      ['apk', 'The newest release has an APK file to download'],
      ['free', 'This app isn’t listed here yet'],
    ];
    list.innerHTML = '';
    var any = false;
    rows.forEach(function (r) {
      var state = checks[r[0]];
      if (state === null) return;
      any = true;
      var li = document.createElement('li');
      var mark = document.createElement('span');
      mark.className = state === true ? 'ok' : state === 'warn' ? 'warn-t' : 'bad';
      mark.textContent = state === true ? '✔' : state === 'warn' ? '⚠' : '✘';
      li.appendChild(mark);
      li.appendChild(document.createTextNode(' ' + r[1]));
      list.appendChild(li);
    });
    $('checklist-box').hidden = !any;
  }

  /* ---------- helpers ---------- */
  function parseRepo(url) {
    var m = String(url).trim()
      .replace(/\.git$/, '').replace(/\/+$/, '')
      .match(/^https:\/\/(github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)\/([^/\s]+)\/([^/\s]+)$/);
    return m ? { host: m[1], owner: m[2], name: m[3], url: 'https://' + m[1] + '/' + m[2] + '/' + m[3] } : null;
  }

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  }

  function setError(id, msg) {
    var el = $(id + '-error');
    if (el) { el.textContent = msg || ''; el.hidden = !msg; }
    var field = $(id);
    if (field && field.tagName !== 'DIV') {
      if (msg) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
  }

  function httpsOrError(id, label) {
    var value = fields[id.replace('f-', '')].value.trim();
    if (!value) { setError(id, ''); return { ok: true, value: '' }; }
    if (!/^https:\/\//.test(value)) {
      setError(id, label + ' must start with https://');
      return { ok: false, value: '' };
    }
    setError(id, '');
    return { ok: true, value: value };
  }

  /* ---------- autofill ---------- */
  $('fetch-btn').addEventListener('click', function () {
    var parsed = parseRepo(fields.repo.value);
    setError('f-repo', '');
    if (!parsed) {
      setError('f-repo', 'Please paste a link that starts with https://github.com/ (or GitLab, Codeberg, Bitbucket).');
      return;
    }
    fields.repo.value = parsed.url;
    if (parsed.host !== 'github.com') {
      toast('Auto-fill works for GitHub for now — please type the details below 😊');
      return;
    }
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Looking at your app… 🔎';

    function get(url) {
      return fetch(url).then(function (r) {
        if (r.status === 404) return { notFound: true };
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      });
    }

    Promise.all([
      get('https://api.github.com/repos/' + parsed.owner + '/' + parsed.name),
      get('https://api.github.com/repos/' + parsed.owner + '/' + parsed.name + '/releases/latest'),
    ]).then(function (results) {
      var info = results[0];
      var release = results[1];
      if (info.notFound) {
        checks.repo = false;
        setError('f-repo', 'We can’t find that page. Is the link right, and is the project public?');
        drawChecks();
        return;
      }
      checks.repo = true;
      if (!fields.name.value) fields.name.value = String(info.name || parsed.name).slice(0, 50);
      if (!fields.tagline.value && info.description) fields.tagline.value = info.description.slice(0, 80);
      if (!fields.description.value && info.description) fields.description.value = info.description;
      if (!fields.website.value && info.homepage && /^https:\/\//.test(info.homepage)) {
        fields.website.value = info.homepage;
      }
      if (!fields.tags.value && info.topics && info.topics.length) {
        fields.tags.value = info.topics.slice(0, 5).join(', ');
      }
      detectedLicense = (info.license && info.license.spdx_id !== 'NOASSERTION' && info.license.spdx_id) || '';
      checks.license = detectedLicense ? true : 'warn';
      checks.apk = !release.notFound && (release.assets || []).some(function (a) {
        return a.name.toLowerCase().endsWith('.apk');
      }) ? true : 'warn';
      checkFree(parsed.url);
      drawChecks();
      updatePreview();
      toast('Filled in what we could find ✨ Check it and pick a category!');
    }).catch(function () {
      toast('GitHub is busy right now — you can type the details yourself 😊');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = '✨ Fill it in for me';
    });
  });

  function checkFree(repoUrl) {
    fetch('/index.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (index) {
      if (!index) return;
      var id = slugify(fields.name.value || '');
      var taken = index.some(function (a) {
        return a.repo.toLowerCase() === repoUrl.toLowerCase() || a.id === id;
      });
      checks.free = taken ? false : true;
      if (taken) setError('f-name', 'An app from this page (or with this name) is already listed.');
      drawChecks();
    }).catch(function () { /* offline preview — skip */ });
  }

  /* ---------- live preview ---------- */
  function updatePreview() {
    var p = $('preview-card');
    if (!p) return;
    var parsed = parseRepo(fields.repo.value);
    p.querySelector('.card-name').textContent = fields.name.value || 'Your app';
    p.querySelector('.card-tagline').textContent = fields.tagline.value || 'One line about what it does';
    var img = p.querySelector('.card-icon');
    img.src = fields.icon.value && /^https:\/\//.test(fields.icon.value)
      ? fields.icon.value
      : parsed && parsed.host === 'github.com'
        ? 'https://github.com/' + parsed.owner + '.png?size=128'
        : img.getAttribute('data-fallback');
  }
  ['name', 'tagline', 'icon', 'repo'].forEach(function (k) {
    fields[k].addEventListener('input', updatePreview);
  });

  /* ---------- build + publish ---------- */
  function buildManifest() {
    var errors = [];
    var parsed = parseRepo(fields.repo.value);
    if (!parsed) errors.push(['f-repo', 'Please paste a link that starts with https://github.com/ (or GitLab, Codeberg, Bitbucket).']);
    var name = fields.name.value.trim();
    if (!name) errors.push(['f-name', 'Please write your app’s name.']);
    if (name.length > 50) errors.push(['f-name', 'Keep the name under 50 letters.']);
    var id = slugify(name) || (parsed ? slugify(parsed.name) : '');
    if (name && !id) errors.push(['f-name', 'Please include some letters or numbers (a–z, 0–9) in the name.']);
    var tagline = fields.tagline.value.trim();
    if (!tagline) errors.push(['f-tagline', 'Please write one short line about your app.']);
    if (tagline.length > 80) errors.push(['f-tagline', 'Keep it under 80 letters — short and sweet!']);
    var description = fields.description.value.trim();
    if (description.length < 20) errors.push(['f-description', 'Tell people a bit more — at least a sentence or two.']);
    var catInput = form.querySelector('input[name="category"]:checked');
    if (!catInput) errors.push(['f-category', 'Pick the group that fits your app best.']);

    var icon = httpsOrError('f-icon', 'The icon link');
    var website = httpsOrError('f-website', 'The website link');
    var download = httpsOrError('f-download', 'The download link');
    if (!icon.ok) errors.push(['f-icon', 'The icon link must start with https://']);
    if (!website.ok) errors.push(['f-website', 'The website link must start with https://']);
    if (!download.ok) errors.push(['f-download', 'The download link must start with https://']);

    ['f-repo', 'f-name', 'f-tagline', 'f-description', 'f-category'].forEach(function (id) { setError(id, ''); });
    if (errors.length) {
      errors.forEach(function (e) { setError(e[0], e[1]); });
      var first = document.querySelector('.field-error:not([hidden])');
      if (first) first.scrollIntoView({ block: 'center' });
      return null;
    }

    var manifest = {
      id: id,
      name: name,
      tagline: tagline,
      description: description,
      repo: parsed.url,
      category: catInput.value,
      license: detectedLicense || 'SEE-REPO',
    };
    if (icon.value) manifest.icon = icon.value;
    var shots = fields.screenshots.value.split('\n').map(function (s) { return s.trim(); })
      .filter(function (s) { return /^https:\/\//.test(s); }).slice(0, 8);
    if (shots.length) manifest.screenshots = shots;
    if (website.value) manifest.website = website.value;
    if (download.value) manifest.download = download.value;
    var tags = fields.tags.value.split(',').map(function (t) { return t.trim().toLowerCase(); })
      .filter(function (t) { return t.length > 0 && t.length <= 30; }).slice(0, 10);
    if (tags.length) manifest.tags = tags;
    var anti = Array.prototype.map.call(
      form.querySelectorAll('input[name="antifeature"]:checked'),
      function (el) { return el.value; }
    );
    if (anti.length) manifest.antiFeatures = anti;
    manifest.added = new Date().toISOString().slice(0, 10);
    return manifest;
  }

  $('publish-btn').addEventListener('click', function () {
    var manifest = buildManifest();
    if (!manifest) return;
    var json = JSON.stringify(manifest, null, 2) + '\n';
    var url = 'https://github.com/' + registry + '/new/' + branch +
      '?filename=' + encodeURIComponent('data/apps/' + manifest.id + '.json') +
      '&value=' + encodeURIComponent(json);
    if (registryReady && url.length <= 7000) {
      window.open(url, '_blank', 'noopener');
      $('after-publish').hidden = false;
      $('after-publish').scrollIntoView({ block: 'center' });
    } else if (registryReady) {
      // Very long description — the pre-filled URL would get cut off by GitHub.
      toast('Your text is quite long — please copy it instead 📋');
      $('copy-fallback').hidden = false;
      $('manifest-out').value = json;
      $('copy-fallback').scrollIntoView({ block: 'center' });
    } else {
      $('copy-fallback').hidden = false;
      $('manifest-out').value = json;
      $('copy-fallback').scrollIntoView({ block: 'center' });
    }
  });

  $('copy-btn').addEventListener('click', function () {
    var manifest = buildManifest();
    if (!manifest) return;
    var json = JSON.stringify(manifest, null, 2) + '\n';
    $('copy-fallback').hidden = false;
    $('manifest-out').value = json;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(function () { toast('Copied! 📋'); }, function () {});
    }
  });
})();
