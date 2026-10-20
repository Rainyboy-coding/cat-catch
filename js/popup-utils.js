function isM3U8(data) {
    return (
        data.ext == "m3u8" ||
        data.ext == "m3u" ||
        data.type?.endsWith("/vnd.apple.mpegurl") ||
        data.type?.endsWith("/x-mpegurl") ||
        data.type?.endsWith("/mpegurl") ||
        data.type?.endsWith("/octet-stream-m3u8")
    )
}
function isMPD(data) {
    return (data.ext == "mpd" ||
        data.type == "application/dash+xml"
    )
}
function isPicture(data) {
    return (data.type?.startsWith("image/") ||
        data.ext == "jpg" ||
        data.ext == "png" ||
        data.ext == "jpeg" ||
        data.ext == "bmp" ||
        data.ext == "gif" ||
        data.ext == "webp" ||
        data.ext == "svg"
    )
}
function isMediaExt(ext) {
    return ['ogg', 'ogv', 'mp4', 'webm', 'mp3', 'wav', 'm4a', '3gp', 'mpeg', 'mov', 'm4s', 'aac'].includes(ext);
}
function isMedia(data) {
    return isMediaExt(data.ext) || data.type?.startsWith("video/") || data.type?.startsWith("audio/");
}
