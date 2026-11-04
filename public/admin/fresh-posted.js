/**
 * Auto-fill "posted" (Added to the site) on calendar + stores when Henrik saves.
 * That date drives the 5-day red New sign on the public site.
 */
(function () {
  var COLLECTIONS = { calendar: true, stores: true };

  function todayYmd() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function bind() {
    if (!window.CMS || !window.CMS.registerEventListener) return false;
    window.CMS.registerEventListener({
      name: 'preSave',
      handler: function (event) {
        var entry = event && event.entry;
        if (!entry || typeof entry.get !== 'function') return entry;
        var collection = entry.get('collection');
        if (!COLLECTIONS[collection]) return entry;
        var data = entry.get('data');
        if (!data || typeof data.get !== 'function') return entry;
        var posted = data.get('posted');
        if (posted) return entry;
        return entry.set('data', data.set('posted', todayYmd()));
      },
    });
    return true;
  }

  if (!bind()) {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (bind() || tries > 40) clearInterval(timer);
    }, 250);
  }
})();
