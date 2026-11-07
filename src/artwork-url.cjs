const COVER_HOSTS = ['yandex.net', 'scdn.co', 'spotifycdn.com', 'sndcdn.com', 'ytimg.com', 'userapi.com', 'vk-cdn.net', 'vkuserphoto.ru', 'vkuserphoto.net', 'mzstatic.com'];
function artworkUrl(value) {
  if (typeof value !== 'string' || value.length > 256) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && COVER_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host)) ? url.href : null;
  } catch { return null; }
}
module.exports = { artworkUrl };
