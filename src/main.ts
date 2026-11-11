import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import './lab.css';
import './cubicles.css';
import { api } from './api';
import { createMap } from './map';
import { store } from './store';
import { mountUi } from './ui';
import { usage } from './usage';
import { schedules } from './schedule-store';

// The composition root: the HTTP adapter is plugged into what reads through it (store, usage, schedules, ui).
const mapEl = document.getElementById('map');
if (!mapEl) throw new Error('missing #map');
const ui = mountUi(createMap(mapEl, (id, at) => ui.tap(id, at)), api);
usage.start(api);
store.start(api);
schedules.start(api);
