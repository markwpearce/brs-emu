/*---------------------------------------------------------------------------------------------
 *  BrightScript 2D API Emulator (https://github.com/lvcabral/brs-emu)
 *
 *  Copyright (c) 2019 Marcelo Lv Cabral. All Rights Reserved.
 *
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

const info = bowser.parse(window.navigator.userAgent);
const supportedBrowser =
    info.platform.type == "desktop" && info.engine.name == "Blink" && info.browser.version > "68";
const fileButton = document.getElementById("fileButton");
const channelInfo = document.getElementById("channelInfo");
const display = document.getElementById("display");
const ctx = display.getContext("2d", { alpha: false });
const loading = document.getElementById("loading");
const channel1 = document.getElementById("channel1");
const channel2 = document.getElementById("channel2");
const channel3 = document.getElementById("channel3");

if (!supportedBrowser) {
    channelIcons("hidden");
    fileButton.style.visibility = "hidden";
    let infoHtml = "";
    infoHtml += "<br/>";
    infoHtml += "Your browser is not supported!";
    channelInfo.innerHTML = infoHtml;
} else {
    channelInfo.innerHTML = "<br/>";
}

// Device Data
const developerId = "UniqueDeveloperId";
const deviceData = {
    developerId: developerId,
    friendlyName: "BrightScript Emulator",
    serialNumber: "BRSEMUAPP070",
    registry: new Map(),
    deviceModel: "8000X",
    firmwareVersion: "049.10E04111A",
    clientId: "6c5bf3a5-b2a5-4918-824d-7691d5c85364",
    RIDA: "f51ac698-bc60-4409-aae3-8fc3abc025c4", // Unique identifier for advertisement tracking
    countryCode: "US",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: "en_US",
    clockFormat: "12h",
    displayMode: "720p", // Supported modes: 480p (SD), 720p (HD) and 1080p (FHD)
    defaultFont: "Asap", // Options: "Asap", "Roboto" or "Open Sans"
    maxSimulStreams: 2, // Max number of audio resource streams
    localIps: ["Ethernet,127.0.0.1"], // Running on the Browser is not possible to get a real IP
    startTime: Date.now(),
};

// Display Aspect Ratio
const isSD = deviceData.displayMode === "480p";
const aspectRatio = isSD ? 4 / 3 : 16 / 9;
const screenSize = { width: isSD ? 640 : 854, height: 480 };

// Display Objects
const bufferCanvas = supportedBrowser
    ? new OffscreenCanvas(screenSize.width, screenSize.height)
    : undefined;
const bufferCtx = supportedBrowser ? bufferCanvas.getContext("2d") : undefined;
let buffer = new ImageData(screenSize.width, screenSize.height);
let splashTimeout = 1600;
let brsWorker;
let title = "";
let source = [];
let paths = [];
let txts = [];
let imgs = [];
let fonts = [];
let running = false;

// Sound Objects
const audioEvent = { SELECTED: 0, FULL: 1, PARTIAL: 2, PAUSED: 3, RESUMED: 4, FAILED: 5 };
Object.freeze(audioEvent);
let soundsIdx = new Map();
let soundsDat = new Array();
let wavStreams = new Array(deviceData.maxSimulStreams);
let playList = new Array();
let playIndex = 0;
let playLoop = false;
let playNext = -1;
resetSounds();

// Shared buffers
const dataType = { KEY: 0, MOD: 1, SND: 2, IDX: 3, WAV: 4 };
Object.freeze(dataType);
const length = 7;
const sharedBuffer = supportedBrowser
    ? new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * length)
    : [0, 0, 0, 0, 0, 0, 0];
const sharedArray = new Int32Array(sharedBuffer);

// Keyboard handlers
document.addEventListener("keydown", keyDownHandler, false);
document.addEventListener("keyup", keyUpHandler, false);

// Load Registry
const storage = window.localStorage;
for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key.substr(0, developerId.length) === developerId) {
        deviceData.registry.set(key, storage.getItem(key));
    }
}

// File selector
const fileSelector = document.getElementById("file");
const zip = new JSZip();
fileButton.onclick = function() {
    fileSelector.click();
};

fileSelector.onclick = function() {
    this.value = null;
};
fileSelector.onchange = function() {
    const file = this.files[0];
    const reader = new FileReader();
    reader.onload = function(progressEvent) {
        title = file.name;
        paths = [];
        imgs = [];
        txts = [];
        fonts = [];
        source.push(this.result);
        paths.push({ url: `source/${file.name}`, id: 0, type: "source" });
        ctx.fillStyle = "rgba(0, 0, 0, 1)";
        ctx.fillRect(0, 0, display.width, display.height);
        runChannel();
    };
    source = [];
    if (brsWorker != undefined) {
        brsWorker.terminate();
    }
    if (file.name.split(".").pop() === "zip") {
        console.log(`Loading ${file.name}...`);
        running = true;
        openChannelZip(file);
    } else {
        running = true;
        reader.readAsText(file);
    }
    display.focus();
};

// Download Zip
function loadZip(zip) {
    if (running) {
        return;
    }
    running = true;
    display.style.opacity = 0;
    loading.style.visibility = "visible";
    channelIcons("visible");
    fileSelector.value = null;
    source = [];
    if (brsWorker != undefined) {
        brsWorker.terminate();
    }
    fetch(zip).then(function(response) {
        if (response.status === 200 || response.status === 0) {
            console.log(`Loading ${zip}...`);
            openChannelZip(response.blob());
            display.focus();
        } else {
            running = false;
            return Promise.reject(new Error(response.statusText));
        }
    });
}

// Uncompress Zip and execute
function openChannelZip(f) {
    JSZip.loadAsync(f).then(
        function(zip) {
            const manifest = zip.file("manifest");
            if (manifest) {
                manifest.async("string").then(
                    function success(content) {
                        const manifestMap = new Map();
                        content.match(/[^\r\n]+/g).map(function(ln) {
                            const line = ln.split("=");
                            manifestMap.set(line[0].toLowerCase(), line[1]);
                        });
                        const splashMinTime = manifestMap.get("splash_min_time");
                        if (splashMinTime && !isNaN(splashMinTime)) {
                            splashTimeout = parseInt(splashMinTime);
                        }
                        let splash;
                        if (deviceData.displayMode === "480p") {
                            splash = manifestMap.get("splash_screen_sd");
                            if (!splash) {
                                splash = manifestMap.get("splash_screen_hd");
                                if (!splash) {
                                    splash = manifestMap.get("splash_screen_fhd");
                                }
                            }
                        } else {
                            splash = manifestMap.get("splash_screen_hd");
                            if (!splash) {
                                splash = manifestMap.get("splash_screen_fhd");
                                if (!splash) {
                                    splash = manifestMap.get("splash_screen_sd");
                                }
                            }
                        }
                        ctx.fillStyle = "rgba(0, 0, 0, 1)";
                        ctx.fillRect(0, 0, display.width, display.height);
                        if (splash && splash.substr(0, 5) === "pkg:/") {
                            const splashFile = zip.file(splash.substr(5));
                            if (splashFile) {
                                splashFile.async("blob").then(blob => {
                                    createImageBitmap(blob).then(imgData => {
                                        channelIcons("hidden");
                                        loading.style.visibility = "hidden";
                                        display.style.opacity = 1;
                                        ctx.drawImage(
                                            imgData,
                                            isSD ? 107 : 0,
                                            0,
                                            screenSize.width,
                                            screenSize.height
                                        );
                                    });
                                });
                            }
                        }
                        fileButton.style.visibility = "hidden";
                        let infoHtml = "";
                        title = manifestMap.get("title");
                        if (title) {
                            infoHtml += title + "<br/>";
                        } else {
                            title = "";
                        }
                        const subtitle = manifestMap.get("subtitle");
                        if (subtitle) {
                            infoHtml += subtitle + "<br/>";
                        }
                        const majorVersion = manifestMap.get("major_version");
                        if (majorVersion) {
                            infoHtml += "v" + majorVersion;
                        }
                        const minorVersion = manifestMap.get("minor_version");
                        if (minorVersion) {
                            infoHtml += "." + minorVersion;
                        }
                        const buildVersion = manifestMap.get("build_version");
                        if (buildVersion) {
                            infoHtml += "." + buildVersion;
                        }
                        channelInfo.innerHTML = infoHtml;
                    },
                    function error(e) {
                        loading.style.visibility = "hidden";
                        clientException(`Error uncompressing manifest: ${e.message}`, true);
                        running = false;
                        return;
                    }
                );
            } else {
                loading.style.visibility = "hidden";
                clientException("Invalid Roku package: missing manifest.", true);
                running = false;
                return;
            }
            const assetPaths = [];
            const assetsEvents = [];
            let bmpId = 0;
            let txtId = 0;
            let srcId = 0;
            let fntId = 0;
            let audId = 0;
            zip.forEach(function(relativePath, zipEntry) {
                const lcasePath = relativePath.toLowerCase();
                const ext = lcasePath.split(".").pop();
                if (!zipEntry.dir && lcasePath.substr(0, 6) === "source" && ext === "brs") {
                    assetPaths.push({ url: relativePath, id: srcId, type: "source" });
                    assetsEvents.push(zipEntry.async("string"));
                    srcId++;
                } else if (
                    !zipEntry.dir &&
                    (lcasePath === "manifest" || ext === "csv" || ext === "xml" || ext === "json")
                ) {
                    assetPaths.push({ url: relativePath, id: txtId, type: "text" });
                    assetsEvents.push(zipEntry.async("string"));
                    txtId++;
                } else if (
                    !zipEntry.dir &&
                    (ext === "png" ||
                        ext === "gif" ||
                        ext === "jpg" ||
                        ext === "jpeg" ||
                        ext === "bmp")
                ) {
                    assetPaths.push({ url: relativePath, id: bmpId, type: "image" });
                    assetsEvents.push(zipEntry.async("arraybuffer"));
                    bmpId++;
                } else if (!zipEntry.dir && (ext === "ttf" || ext === "otf")) {
                    assetPaths.push({ url: relativePath, id: fntId, type: "font" });
                    assetsEvents.push(zipEntry.async("arraybuffer"));
                    fntId++;
                } else if (
                    !zipEntry.dir &&
                    (ext === "wav" ||
                        ext === "mp2" ||
                        ext === "mp3" ||
                        ext === "mp4" ||
                        ext === "m4a" ||
                        ext === "aac" ||
                        ext === "ogg" ||
                        ext === "oga" ||
                        ext === "ac3" ||
                        ext === "wma" ||
                        ext === "flac")
                ) {
                    assetPaths.push({ url: relativePath, id: audId, type: "audio", format: ext });
                    assetsEvents.push(zipEntry.async("blob"));
                    audId++;
                }
            });
            Promise.all(assetsEvents).then(
                function success(assets) {
                    paths = [];
                    txts = [];
                    imgs = [];
                    fonts = [];
                    for (let index = 0; index < assets.length; index++) {
                        paths.push(assetPaths[index]);
                        if (assetPaths[index].type === "image") {
                            imgs.push(assets[index]);
                        } else if (assetPaths[index].type === "font") {
                            fonts.push(assets[index]);
                        } else if (assetPaths[index].type === "source") {
                            source.push(assets[index]);
                        } else if (assetPaths[index].type === "audio") {
                            addSound(
                                `pkg:/${assetPaths[index].url}`,
                                assetPaths[index].format,
                                assets[index]
                            );
                        } else if (assetPaths[index].type === "text") {
                            txts.push(assets[index]);
                        }
                    }
                    setTimeout(function() {
                        runChannel();
                    }, splashTimeout);
                },
                function error(e) {
                    loading.style.visibility = "hidden";
                    clientException(`Error uncompressing file ${e.message}`);
                }
            );
        },
        function(e) {
            loading.style.visibility = "hidden";
            clientException(`Error reading ${f.name}: ${e.message}`, true);
            running = false;
        }
    );
}

// Execute Emulator Web Worker
function runChannel() {
    channelIcons("hidden");
    loading.style.visibility = "hidden";
    display.style.opacity = 1;
    display.focus();
    brsWorker = new Worker("./lib/brsEmu.js");
    brsWorker.addEventListener("message", receiveMessage);
    const payload = {
        device: deviceData,
        title: title,
        paths: paths,
        brs: source,
        texts: txts,
        fonts: fonts,
        images: imgs,
    };
    brsWorker.postMessage(sharedBuffer);
    brsWorker.postMessage(payload, imgs);
}

// Receive Messages from the Web Worker
function receiveMessage(event) {
    if (event.data instanceof ImageData) {
        buffer = event.data;
        bufferCanvas.width = buffer.width;
        bufferCanvas.height = buffer.height;
        bufferCtx.putImageData(buffer, 0, 0);
        ctx.drawImage(bufferCanvas, isSD ? 107 : 0, 0, screenSize.width, screenSize.height);
    } else if (event.data instanceof Map) {
        deviceData.registry = event.data;
        deviceData.registry.forEach(function(value, key) {
            storage.setItem(key, value);
        });
    } else if (event.data instanceof Array) {
        if (playList.length > 0) {
            stopSound();
        }
        playList = event.data;
        playIndex = 0;
        playNext = -1;
    } else if (event.data.audioPath) {
        addSound(event.data.audioPath, event.data.audioFormat, new Blob([event.data.audioData]));
    } else if (event.data === "play") {
        playSound();
    } else if (event.data === "stop") {
        stopSound();
    } else if (event.data === "pause") {
        const audio = playList[playIndex];
        if (audio && soundsIdx.has(audio.toLowerCase())) {
            const sound = soundsDat[soundsIdx.get(audio.toLowerCase())];
            sound.pause();
            sharedArray[dataType.SND] = audioEvent.PAUSED;
        } else {
            clientException(`Can't find audio data: ${audio}`);
        }
    } else if (event.data === "resume") {
        const audio = playList[playIndex];
        if (audio && soundsIdx.has(audio.toLowerCase())) {
            const sound = soundsDat[soundsIdx.get(audio.toLowerCase())];
            sound.play();
            sharedArray[dataType.SND] = audioEvent.RESUMED;
        } else {
            clientException(`Can't find audio data: ${audio}`);
        }
    } else if (event.data.substr(0, 4) === "loop") {
        const loop = event.data.split(",")[1];
        if (loop) {
            playLoop = loop === "true";
        } else {
            clientException(`Missing loop parameter: ${event.data}`);
        }
    } else if (event.data.substr(0, 4) === "next") {
        const newIndex = event.data.split(",")[1];
        if (newIndex && !isNaN(parseInt(newIndex))) {
            playNext = parseInt(newIndex);
            if (playNext >= playList.length) {
                playNext = -1;
                clientException(`Next index out of range: ${newIndex}`);
            }
        } else {
            clientException(`Invalid index: ${event.data}`);
        }
    } else if (event.data.substr(0, 4) === "seek") {
        const audio = playList[playIndex];
        const position = event.data.split(",")[1];
        if (position && !isNaN(parseInt(position))) {
            if (audio && soundsIdx.has(audio.toLowerCase())) {
                const sound = soundsDat[soundsIdx.get(audio.toLowerCase())];
                sound.seek(parseInt(position));
            } else {
                clientException(`Can't find audio data: ${audio}`);
            }
        } else {
            clientException(`Invalid seek position: ${event.data}`);
        }
    } else if (event.data.substr(0, 7) === "trigger") {
        const wav = event.data.split(",")[1];
        if (wav && soundsIdx.has(wav.toLowerCase())) {
            const soundId = soundsIdx.get(wav.toLowerCase());
            const sound = soundsDat[soundId];
            const volume = parseInt(event.data.split(",")[2]) / 100;
            const index = parseInt(event.data.split(",")[3]);
            if (volume && !isNaN(volume)) {
                sound.volume(volume);
            }
            if (index >= 0 && index < deviceData.maxSimulStreams) {
                if (wavStreams[index] && wavStreams[index].playing()) {
                    wavStreams[index].stop();
                }
                wavStreams[index] = sound;
                sound.on("end", function() {
                    sharedArray[dataType.WAV + index] = -1;
                });
                sound.play();
                sharedArray[dataType.WAV + index] = soundId;
            }
        }
    } else if (event.data.substr(0, 5) === "stop,") {
        const wav = event.data.split(",")[1];
        if (wav && soundsIdx.has(wav.toLowerCase())) {
            const soundId = soundsIdx.get(wav.toLowerCase());
            const sound = soundsDat[soundId];
            for (let index = 0; index < deviceData.maxSimulStreams; index++) {
                if (sharedArray[dataType.WAV + index] === soundId) {
                    sharedArray[dataType.WAV + index] = -1;
                    break;
                }
            }
            sound.stop();
        } else {
            clientException(`Can't find wav sound: ${wav}`);
        }
    } else if (event.data.substr(0, 4) === "log,") {
        console.log(event.data.substr(4));
    } else if (event.data.substr(0, 8) === "warning,") {
        console.warn(event.data.substr(8));
    } else if (event.data.substr(0, 6) === "error,") {
        console.error(event.data.substr(6));
    } else if (event.data === "end") {
        console.log(`------ Finished '${title}' execution ------`);
        closeChannel();
    } else if (event.data === "reset") {
        window.location.reload(false);
    }
}

function playSound() {
    const audio = playList[playIndex];
    if (audio) {
        let sound;
        if (soundsIdx.has(audio.toLowerCase())) {
            sound = soundsDat[soundsIdx.get(audio.toLowerCase())];
        } else if (audio.substr(0, 4).toLowerCase() === "http") {
            sound = addWebSound(audio);
        } else {
            clientException(`Can't find audio data: ${audio}`);
            return;
        }
        sound.seek(0);
        sound.once("end", nextSound);
        if (sound.state() === "unloaded") {
            sound.once("load", function() {
                sound.play();
            });
            sound.load();
        } else {
            sound.play();
        }
        sharedArray[dataType.IDX] = playIndex;
        sharedArray[dataType.SND] = audioEvent.SELECTED;
    } else {
        clientException(`Can't find audio index: ${playIndex}`);
    }
}

function nextSound() {
    if (playNext >= 0 && playNext < playList.length) {
        playIndex = playNext;
    } else {
        playIndex++;
    }
    playNext = -1;
    if (playIndex < playList.length) {
        playSound();
    } else if (playLoop) {
        playIndex = 0;
        playSound();
    } else {
        playIndex = 0;
        sharedArray[dataType.SND] = audioEvent.FULL;
    }
}

function stopSound() {
    const audio = playList[playIndex];
    if (audio && soundsIdx.has(audio.toLowerCase())) {
        const sound = soundsDat[soundsIdx.get(audio.toLowerCase())];
        sound.stop();
        sharedArray[dataType.SND] = audioEvent.PARTIAL;
    } else {
        clientException(`Can't find audio data: ${audio}`);
    }
}
// Add new Audio File
function addSound(path, format, data) {
    soundsIdx.set(path.toLowerCase(), soundsDat.length);
    soundsDat.push(
        new Howl({
            src: [URL.createObjectURL(data)],
            format: format,
            preload: format === "wav",
            onloaderror: function(id, message) {
                clientException(`Error loading ${path}: ${message}`);
            },
            onplayerror: function(id, message) {
                clientException(`Error playing ${path}: ${message}`);
            },
        })
    );
}
function addWebSound(url) {
    // TODO: Fix the WAV index if a roAudioResource is created after this call
    soundsIdx.set(url.toLowerCase(), soundsDat.length);
    let sound = new Howl({
        src: [url],
        preload: true,
        onloaderror: function(id, message) {
            clientException(`Error loading ${path}: ${message}`);
        },
        onplayerror: function(id, message) {
            clientException(`Error playing ${path}: ${message}`);
        },
    });
    soundsDat.push(sound);
    return sound;
}

// (Re)Initializes Sounds Engine
function resetSounds() {
    if (soundsDat.length > 0) {
        soundsDat.forEach(sound => {
            sound.unload();
        });
    }
    soundsIdx = new Map();
    soundsDat = new Array();
    wavStreams = new Array(deviceData.maxSimulStreams);
    soundsIdx.set("select", 0);
    soundsDat.push(new Howl({ src: ["./audio/select.wav"] }));
    soundsIdx.set("navsingle", 1);
    soundsDat.push(new Howl({ src: ["./audio/navsingle.wav"] }));
    soundsIdx.set("navmulti", 2);
    soundsDat.push(new Howl({ src: ["./audio/navmulti.wav"] }));
    soundsIdx.set("deadend", 3);
    soundsDat.push(new Howl({ src: ["./audio/deadend.wav"] }));
    playList = new Array();
    playIndex = 0;
    playLoop = false;
    playNext = -1;
}

// Restore emulator menu and terminate Worker
function closeChannel() {
    display.style.opacity = 0;
    channelInfo.innerHTML = "<br/>";
    fileButton.style.visibility = "visible";
    channelIcons("visible");
    fileSelector.value = null;
    brsWorker.terminate();
    sharedArray[dataType.KEY] = 0;
    sharedArray[dataType.SND] = -1;
    sharedArray[dataType.IDX] = -1;
    resetSounds();
    running = false;
}

// Remote control emulator
function keyDownHandler(event) {
    if (event.keyCode == 8) {
        sharedArray[dataType.KEY] = 0; // BUTTON_BACK_PRESSED
    } else if (event.keyCode == 13) {
        sharedArray[dataType.KEY] = 6; // BUTTON_SELECT_PRESSED
        event.preventDefault();
    } else if (event.keyCode == 37) {
        sharedArray[dataType.KEY] = 4; // BUTTON_LEFT_PRESSED
        event.preventDefault();
    } else if (event.keyCode == 39) {
        sharedArray[dataType.KEY] = 5; // BUTTON_RIGHT_PRESSED
        event.preventDefault();
    } else if (event.keyCode == 38) {
        sharedArray[dataType.KEY] = 2; // BUTTON_UP_PRESSED
        event.preventDefault();
    } else if (event.keyCode == 40) {
        sharedArray[dataType.KEY] = 3; // BUTTON_DOWN_PRESSED
        event.preventDefault();
    } else if (event.keyCode == 111) {
        sharedArray[dataType.KEY] = 7; // BUTTON_INSTANT_REPLAY_PRESSED
    } else if (event.keyCode == 106) {
        sharedArray[dataType.KEY] = 10; // BUTTON_INFO_PRESSED
    } else if (event.keyCode == 188) {
        sharedArray[dataType.KEY] = 8; // BUTTON_REWIND_PRESSED
    } else if (event.keyCode == 32) {
        sharedArray[dataType.KEY] = 13; // BUTTON_PLAY_PRESSED
        event.preventDefault();
    } else if (event.keyCode == 190) {
        sharedArray[dataType.KEY] = 9; // BUTTON_FAST_FORWARD_PRESSED
    } else if (event.keyCode == 65) {
        sharedArray[dataType.KEY] = 17; // BUTTON_A_PRESSED
    } else if (event.keyCode == 90) {
        sharedArray[dataType.KEY] = 18; // BUTTON_B_PRESSED
    } else if (event.keyCode == 27) {
        if (brsWorker != undefined) {
            // HOME BUTTON (ESC)
            closeChannel();
        }
    }
    // TODO: Send TimeSinceLastKeypress()
}

function keyUpHandler(event) {
    if (event.keyCode == 8) {
        sharedArray[dataType.KEY] = 100; // BUTTON_BACK_RELEASED
    } else if (event.keyCode == 13) {
        sharedArray[dataType.KEY] = 106; // BUTTON_SELECT_RELEASED
    } else if (event.keyCode == 37) {
        sharedArray[dataType.KEY] = 104; // BUTTON_LEFT_RELEASED
    } else if (event.keyCode == 39) {
        sharedArray[dataType.KEY] = 105; // BUTTON_RIGHT_RELEASED
    } else if (event.keyCode == 38) {
        sharedArray[dataType.KEY] = 102; // BUTTON_UP_RELEASED
    } else if (event.keyCode == 40) {
        sharedArray[dataType.KEY] = 103; // BUTTON_DOWN_RELEASED
    } else if (event.keyCode == 111) {
        sharedArray[dataType.KEY] = 107; // BUTTON_INSTANT_REPLAY_RELEASED
    } else if (event.keyCode == 106) {
        sharedArray[dataType.KEY] = 110; // BUTTON_INFO_RELEASED
    } else if (event.keyCode == 188) {
        sharedArray[dataType.KEY] = 108; // BUTTON_REWIND_RELEASED
    } else if (event.keyCode == 32) {
        sharedArray[dataType.KEY] = 113; // BUTTON_PLAY_RELEASED
    } else if (event.keyCode == 190) {
        sharedArray[dataType.KEY] = 109; // BUTTON_FAST_FORWARD_RELEASED
    } else if (event.keyCode == 65) {
        sharedArray[dataType.KEY] = 117; // BUTTON_A_RELEASED
    } else if (event.keyCode == 90) {
        sharedArray[dataType.KEY] = 118; // BUTTON_B_RELEASED
    }
}

// Channel icons Visibility
function channelIcons(visibility) {
    if (channel3) {
        channel1.style.visibility = visibility;
        channel2.style.visibility = visibility;
        channel3.style.visibility = visibility;
    }
}

// Exception Handler
function clientException(msg, msgbox = false) {
    console.error(msg);
    if (msgbox) {
        window.alert(msg);
    }
}
