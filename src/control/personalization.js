(function (root) {
  function create(action) {
    const $ = id => document.getElementById(id);
    const home = document.createElement('div');
    home.innerHTML = `<h3 class="section-title">Ваш никнейм</h3><form id="nickname-form" class="card personal-card"><label for="nickname">Подпись под обложкой</label><div class="button-row"><input id="nickname" maxlength="24" autocomplete="nickname" spellcheck="false" required aria-describedby="nickname-help"><button class="primary">Сохранить никнейм</button></div><p id="nickname-help" class="footnote">До 12 символов.</p><p id="nickname-status" role="status" class="footnote"></p></form>
    <h3 class="section-title">Автоскрытие</h3><div class="card settings-list"><label class="setting-row"><span><strong>Скрывать во время паузы</strong><small>При воспроизведении виджет возвращается без перехвата фокуса</small></span><input id="auto-hide" class="switch" type="checkbox"></label><label class="setting-row"><span><strong>Задержка, секунд</strong><small>В режиме перемещения виджет остаётся видимым</small></span><input id="auto-hide-delay" type="number" min="5" max="600" step="1" aria-label="Задержка автоскрытия, секунд"></label></div>
    <h3 class="section-title">Расположение</h3><div class="card settings-list"><label class="setting-row"><span><strong>Монитор</strong><small>При отключении монитора виджет возвращается на доступный экран</small></span><select id="monitor" aria-label="Монитор виджета"></select></label><label class="setting-row"><span><strong>Прилипать к краям</strong><small>Мягкая привязка после перемещения рядом с краем экрана</small></span><input id="snap-enabled" type="checkbox" class="switch"></label><label class="setting-row"><span><strong>Отступ от края, px</strong></span><input id="edge-margin" type="number" min="0" max="100" step="1" aria-label="Отступ от края"></label></div>
    <h3 class="section-title">Перенос настроек</h3><div class="card personal-card"><p class="description">Сохраните оформление, никнейм, бинды и положения виджета в JSON. Подключения браузеров в файл не включаются.</p><div class="button-row"><button id="settings-export">Экспорт настроек</button><button id="settings-import">Импорт настроек</button></div><p id="transfer-status" class="footnote" role="status"></p></div>`;
    $('page-home').append(home);
    const appearance = document.createElement('div');
    appearance.innerHTML = `<div class="card settings-list"><label class="setting-row color-source-row"><select id="color-mode" aria-label="Источник цвета"><option value="manual">Моя палитра</option><option value="artwork">Из обложки</option></select></label></div><h3 class="section-title">Конструктор виджета</h3><div class="card settings-list"><label class="setting-row"><span><strong>Обложка</strong></span><input id="show-artwork" type="checkbox" class="switch"></label><label class="setting-row"><span><strong>Исполнитель</strong></span><input id="show-artist" type="checkbox" class="switch"></label><label class="setting-row"><span><strong>Время трека</strong></span><input id="show-time" type="checkbox" class="switch"></label></div>`;
    $('page-appearance').insertBefore(appearance, $('page-appearance').children[1]);
    let nickDirty = false, monitorKey = '';
    $('nickname').addEventListener('input', () => { nickDirty = true; $('nickname-status').textContent = `${Array.from($('nickname').value.normalize('NFC').trim()).length}/12`; });
    $('nickname-form').addEventListener('submit', async event => { event.preventDefault(); const result = await action('preferences', { nickname: $('nickname').value }); if (result.ok) { nickDirty = false; $('nickname-status').textContent = 'Никнейм сохранён'; } });
    for (const [id, key] of [['auto-hide','autoHide'],['snap-enabled','snapEnabled'],['show-artwork','showArtwork'],['show-artist','showArtist'],['show-time','showTime']]) $(id).addEventListener('change', () => action('preferences', { [key]: $(id).checked }));
    for (const [id, key] of [['auto-hide-delay','autoHideDelay'],['edge-margin','edgeMargin']]) $(id).addEventListener('change', () => { if ($(id).checkValidity()) action('preferences', { [key]: Number($(id).value) }); else $(id).reportValidity(); });
    $('monitor').addEventListener('change', () => action('preferences', { monitor: $('monitor').value }));
    $('color-mode').addEventListener('change', () => action('preferences', { colorMode: $('color-mode').value }));
    for (const name of ['export', 'import']) $(`settings-${name}`).addEventListener('click', async event => { event.target.disabled = true; try { const result = await action(name); if (result.ok && !result.cancelled) $('transfer-status').textContent = name === 'export' ? 'Настройки сохранены в файл' : 'Настройки импортированы'; } finally { event.target.disabled = false; } });
    return { update(state) {
      const p = state.preferences;
      if (!nickDirty) $('nickname').value = p.nickname;
      for (const [id, key] of [['auto-hide','autoHide'],['snap-enabled','snapEnabled'],['show-artwork','showArtwork'],['show-artist','showArtist'],['show-time','showTime']]) $(id).checked = p[key];
      for (const [id, key] of [['auto-hide-delay','autoHideDelay'],['edge-margin','edgeMargin']]) if (document.activeElement !== $(id)) $(id).value = p[key];
      $('auto-hide-delay').disabled = !p.autoHide; $('edge-margin').disabled = !p.snapEnabled; $('color-mode').value = p.colorMode;
      const key = JSON.stringify([state.displays, p.monitor]);
      if (key !== monitorKey) { monitorKey = key; const options = [new Option('Автоматически', 'auto'), ...(state.displays || []).map(d => new Option(`${d.name} · ${d.width} × ${d.height}`, d.id))]; if (p.monitor !== 'auto' && !state.displays?.some(d => d.id === p.monitor)) options.push(new Option('Монитор отключён · временно другой', p.monitor)); $('monitor').replaceChildren(...options); $('monitor').value = p.monitor; }
    } };
  }
  root.LibertyPersonalization = { create };
})(globalThis);
