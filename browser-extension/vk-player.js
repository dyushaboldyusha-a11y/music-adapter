(function (root) {
  function create(window) {
    let player, beforeMute = .5;
    function snapshot() {
      try {
        player = window.getAudioPlayer?.();
        const audio = player?.getCurrentAudio?.();
        if (!audio) return null;
        const duration = Number(Array.isArray(audio) ? audio[5] : audio.duration) || 0;
        const progress = player.getCurrentProgress?.();
        let position = null;
        if (typeof progress === 'number' && Number.isFinite(progress)) position = progress >= 0 && progress <= 1 ? progress * duration : progress;
        else if (Array.isArray(progress) && Number.isFinite(progress[0])) position = progress[0];
        else if (progress && Number.isFinite(progress.currentTime ?? progress.position)) position = progress.currentTime ?? progress.position;
        const image = Array.isArray(audio) ? audio[14] : audio.album?.thumb?.photo_600 || audio.thumb?.photo_600 || audio.cover;
        const artworkUrl = typeof image === 'string' ? image.startsWith('data:image/') ? image : image.split(',').filter(Boolean).at(-1) : '';
        let volume = null;
        try { const value = player.getVolume?.(); if (Number.isFinite(value) && value >= 0 && value <= 1) volume = value; } catch {}
        const canVolume = volume !== null && typeof player.setVolume === 'function';
        return { title: String(Array.isArray(audio) ? audio[3] || '' : audio.title || ''), artist: String(Array.isArray(audio) ? audio[4] || '' : audio.artist || audio.performer || ''), duration, position, playing: typeof player.isPlaying === 'function' ? !!player.isPlaying() : null, artworkUrl, volume, muted: volume === 0, capabilities: { playPause: typeof player.isPlaying === 'function' && typeof player.play === 'function' && typeof player.pause === 'function', next: typeof player.playNext === 'function', previous: typeof player.playPrev === 'function', volume: canVolume, mute: canVolume, seek: duration > 0 && typeof progress === 'number' && progress >= 0 && progress <= 1 && typeof player.seek === 'function' } };
      } catch { return null; }
    }
    async function command(action, value) {
      const state = snapshot();
      if (!state?.capabilities[action]) throw new Error('Команда VK Музыки недоступна');
      if (action === 'playPause') await (state.playing ? player.pause() : player.play());
      if (action === 'next') await player.playNext();
      if (action === 'previous') await player.playPrev();
      if (action === 'volume') { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Некорректная громкость'); await player.setVolume(value); }
      if (action === 'mute') { if (typeof value !== 'boolean') throw new Error('Некорректное состояние звука'); if (value && state.volume > 0) beforeMute = state.volume; await player.setVolume(value ? 0 : beforeMute); }
      if (action === 'seek') await player.seek(Math.max(0, Math.min(1, value / state.duration)));
    }
    return { snapshot, command };
  }
  if (typeof module !== 'undefined') module.exports = { create };
  root.LibertyVK = { create };
})(globalThis);
