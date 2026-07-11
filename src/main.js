import { supabase } from './supabaseClient.js';

let isPlaying = false;
let currentPoem = null;
let globalPoems = [];
let globalReciters = [];

// LocalStorage wrapper for Library features
const LibraryStore = {
  get likes() { return JSON.parse(localStorage.getItem('sawt_likes')) || []; },
  set likes(arr) { localStorage.setItem('sawt_likes', JSON.stringify(arr)); },
  
  get downloads() { return JSON.parse(localStorage.getItem('sawt_downloads')) || []; },
  set downloads(arr) { localStorage.setItem('sawt_downloads', JSON.stringify(arr)); },
  
  get playlists() { return JSON.parse(localStorage.getItem('sawt_playlists')) || []; },
  set playlists(arr) { localStorage.setItem('sawt_playlists', JSON.stringify(arr)); },
  
  get artists() { return JSON.parse(localStorage.getItem('sawt_artists')) || []; },
  set artists(arr) { localStorage.setItem('sawt_artists', JSON.stringify(arr)); },

  toggleLike(id) {
    let arr = this.likes;
    if (arr.includes(id)) arr = arr.filter(x => x !== id);
    else arr.push(id);
    this.likes = arr;
    return arr.includes(id);
  },

  async toggleDownload(id) {
    let arr = this.downloads;
    const isDownloading = !arr.includes(id);
    
    if (isDownloading) {
      arr.push(id);
      if ('caches' in window) {
        const track = globalPoems.find(p => p.id === id);
        if (track) {
          try {
            const cache = await caches.open('sawt-alahzan-audio-cache-v1');
            if (track.audioUrl) {
              const res = await fetch(track.audioUrl);
              await cache.put(track.audioUrl, res);
            }
            const imgUrl = track.coverImage || track.image;
            if (imgUrl) {
              const imgRes = await fetch(imgUrl);
              await cache.put(imgUrl, imgRes);
            }
          } catch(e) { console.error('Cache error', e); }
        }
      }
    } else {
      arr = arr.filter(x => x !== id);
      if ('caches' in window) {
        const track = globalPoems.find(p => p.id === id);
        if (track) {
          try {
            const cache = await caches.open('sawt-alahzan-audio-cache-v1');
            if (track.audioUrl) await cache.delete(track.audioUrl);
          } catch(e) {}
        }
      }
    }
    this.downloads = arr;
    return isDownloading;
  },

  addPlaylist(name) {
    let arr = this.playlists;
    arr.push({ id: Date.now().toString(), name, tracks: [] });
    this.playlists = arr;
  },

  addTrackToPlaylist(playlistId, trackId) {
    let arr = this.playlists;
    let pl = arr.find(p => p.id === playlistId);
    if (pl) {
      if (!pl.tracks.includes(trackId)) {
        pl.tracks.push(trackId);
        this.playlists = arr;
        return true;
      }
    }
    return false;
  }
};

// Loading State
function showLoading() {
  const container = document.getElementById('sections-container');
  container.innerHTML = `
    <div style="display: flex; justify-content: center; padding: 100px 0;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size: 40px; color: var(--accent);"></i>
    </div>
  `;
}

// Fetch Supabase Data
async function fetchAppData() {
  showLoading();
  
  try {
    // Fetch Poems (Audio Library) - limit to 3000 to get a large library
    const { data: audioData, error: audioError } = await supabase
      .from('audio_library')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3000);
      
    if (audioError) throw audioError;
    
    // Transform Data
    globalPoems = (audioData || []).map(p => ({
      id: p.id,
      title: p.title || p.file_name || '\u0642\u0635\u064a\u062f\u0629 \u0628\u062f\u0648\u0646 \u0639\u0646\u0648\u0627\u0646',
      reciterName: translateReciterName(p.reciter_name),
      coverImage: p.image_url || 'https://images.unsplash.com/photo-1542332213-9b5a5a3fad35?w=500',
      audioUrl: p.file_url || p.audio_url || p.url,
      category: p.category || 'variety'
    }));

    // Dynamically extract unique reciters from the tracks!
    const reciterMap = {};
    globalPoems.forEach(p => {
      if (!reciterMap[p.reciterName]) {
        reciterMap[p.reciterName] = {
          id: p.reciterName,
          name: p.reciterName,
          image: p.coverImage // use the cover image of their first track as their profile picture
        };
      }
    });
    globalReciters = Object.values(reciterMap);

    renderHomeContent(globalPoems, globalReciters);
  } catch (err) {
    console.error('Error fetching data:', err);
    document.getElementById('sections-container').innerHTML = `
      <div style="text-align: center; color: red; padding: 50px;">
        \u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u062c\u0644\u0628 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a. \u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u0623\u0643\u062f \u0645\u0646 \u0627\u062a\u0635\u0627\u0644 \u0627\u0644\u0625\u0646\u062a\u0631\u0646\u062a \u0648\u0635\u0644\u0627\u062d\u064a\u0627\u062a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a.
      </div>
    `;
  }
}

// Render Home Content based on fetched data
function renderHomeContent(poems, reciters) {
  const container = document.getElementById('sections-container');
  container.innerHTML = '';
  
  if (poems.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 50px; color: white;">\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0642\u0627\u0637\u0639 \u0635\u0648\u062a\u064a\u0629 \u0645\u0636\u0627\u0641\u0629 \u0628\u0639\u062f.</div>';
    return;
  }
  
  // Helper to shuffle array
  const shuffle = (array) => [...array].sort(() => 0.5 - Math.random());
  
  // Section 1: Top Grid (Grid 2x3 - 6 cards)
  container.appendChild(createRecentGridSection(poems.slice(0, 6)));
  
  // Section 2: Recently Added (New single row horizontal scroller with rectangular cards)
  container.appendChild(createHorizontalRectScrollerSection('\u0645\u0636\u0627\u0641 \u062d\u062f\u064a\u062b\u0627', poems.slice(0, 15)));
  
  // Section 3: Recently Listened (5 columns x 5 cards horizontal scroller)
  container.appendChild(createHorizontalGridScrollerSection('\u062a\u0645 \u0627\u0644\u0627\u0633\u062a\u0645\u0627\u0639 \u0627\u0644\u064a\u0647 \u0645\u0624\u062e\u0631\u0627', shuffle(poems).slice(0, 25)));
  
  // 1. \u0635\u0645\u0645 \u0645\u0646 \u0627\u062c\u0644 \u0627\u0644\u0636\u064a\u0641
  container.appendChild(createSquareScrollerSection('\u0635\u0645\u0645 \u0645\u0646 \u0627\u062c\u0644 \u0627\u0644\u0636\u064a\u0641', shuffle(poems).slice(0, 15)));
  
  // 2. \u0627\u0633\u062a\u0645\u0639 \u0644\u0644\u0642\u0635\u0627\u0626\u062f \u0627\u0644\u062a\u064a \u0627\u062d\u0628\u0628\u062a\u0647\u0627 \u064a\u0648\u0645\u0627 \u0645\u0627
  container.appendChild(createSquareScrollerSection('\u0627\u0633\u062a\u0645\u0639 \u0644\u0644\u0642\u0635\u0627\u0626\u062f \u0627\u0644\u062a\u064a \u0627\u062d\u0628\u0628\u062a\u0647\u0627 \u064a\u0648\u0645\u0627 \u0645\u0627', shuffle(poems).slice(0, 15)));
  
  // 3. \u062a\u0648\u0635\u064a\u0627\u062a\u0646\u0627 \u0644\u0643 \u0627\u0644\u064a\u0648\u0645
  container.appendChild(createSquareScrollerSection('\u062a\u0648\u0635\u064a\u0627\u062a\u0646\u0627 \u0644\u0643 \u0627\u0644\u064a\u0648\u0645', shuffle(poems).slice(0, 15)));
  
  // 4. \u0627\u0644\u0645\u0632\u064a\u062f \u0645\u062b\u0644
  if (reciters.length > 0) {
    const randomReciter = reciters[Math.floor(Math.random() * reciters.length)];
    const moreLike = poems.filter(p => p.reciterName === randomReciter.name || Math.random() > 0.8).slice(0, 15);
    container.appendChild(createSquareScrollerSection('\u0627\u0644\u0645\u0632\u064a\u062f \u0645\u062b\u0644 ' + randomReciter.name, moreLike));
  } else {
    container.appendChild(createSquareScrollerSection('\u0627\u0644\u0645\u0632\u064a\u062f \u0645\u062b\u0644', shuffle(poems).slice(0, 15)));
  }
  
  // 5. \u0627\u0644\u0645\u062d\u0637\u0627\u062a \u0627\u0644\u0645\u0642\u062a\u0631\u062d\u0629
  container.appendChild(createSquareScrollerSection('\u0627\u0644\u0645\u062d\u0637\u0627\u062a \u0627\u0644\u0645\u0642\u062a\u0631\u062d\u0629', shuffle(poems).slice(0, 15)));
  
  // 6. \u0627\u0644\u0623\u0643\u062b\u0631 \u0627\u0633\u062a\u0645\u0627\u0639\u0627
  container.appendChild(createHorizontalGridScrollerSection('\u0627\u0644\u0623\u0643\u062b\u0631 \u0627\u0633\u062a\u0645\u0627\u0639\u0627', shuffle(poems).slice(0, 25)));
  
  // 7. \u0645\u064a\u0643\u0633 \u062a\u0645 \u0627\u0639\u062f\u0627\u062f\u0647 \u0644\u0643
  container.appendChild(createSquareScrollerSection('\u0645\u064a\u0643\u0633 \u062a\u0645 \u0627\u0639\u062f\u0627\u062f\u0647 \u0644\u0643', shuffle(poems).slice(0, 15)));

  // Circular Reciters section at the bottom
  container.appendChild(createReciterSection('\u0623\u0634\u0647\u0631 \u0627\u0644\u0631\u0648\u0627\u062f\u064a\u062f', shuffle(reciters).slice(0, 10)));
}

// Create a horizontal scroller with a single row of LARGE rectangular cards
function createHorizontalRectScrollerSection(titleText, items) {
  const section = document.createElement('div');
  section.className = 'section animate-in';
  
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = titleText;
  section.appendChild(title);
  
  const scroller = document.createElement('div');
  scroller.className = 'horizontal-scroller';
  scroller.style.scrollSnapType = 'x mandatory';
  scroller.style.paddingBottom = '15px';
  
  items.forEach(item => {
    const card = document.createElement('div');
    card.style.position = 'relative';
    card.style.flexShrink = '0';
    card.style.width = '80vw'; // Large width
    card.style.maxWidth = '320px';
    card.style.height = '160px'; // Large height (Rectangle)
    card.style.scrollSnapAlign = 'center';
    card.style.borderRadius = '12px';
    card.style.overflow = 'hidden';
    card.style.cursor = 'pointer';
    card.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
    
    card.innerHTML = `
      <img src="${item.coverImage || item.image}" alt="${item.title || item.name}" style="width: 100%; height: 100%; object-fit: cover;" />
      <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(0deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 100%); padding: 30px 15px 10px 15px; text-align: right;">
        <div style="font-size: 16px; font-weight: bold; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px;">${item.title || item.name}</div>
        <div style="font-size: 13px; color: rgba(255,255,255,0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.reciterName || '\u0645\u062c\u0647\u0648\u0644'}</div>
      </div>
    `;
    card.onclick = () => {
      if (item.audioUrl) openTrackDetail(item.id);
    };
    scroller.appendChild(card);
  });
  
  section.appendChild(scroller);
  return section;
}

// Create a 2-column grid section (Spotify "Recently played" style)
function createRecentGridSection(items) {
  const section = document.createElement('div');
  section.className = 'section animate-in';
  
  const grid = document.createElement('div');
  grid.className = 'recent-grid';
  
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'recent-card';
    card.innerHTML = `
      <img src="${item.image || item.coverImage}" alt="${item.title || item.name}" class="recent-img" />
      <div class="recent-title">${item.title || item.name}</div>
    `;
    card.onclick = () => {
      if (item.audioUrl) openTrackDetail(item.id);
    };
    grid.appendChild(card);
  });
  
  section.appendChild(grid);
  return section;
}

// Create a horizontal scroller with 5 columns, 5 small cards per column
function createHorizontalGridScrollerSection(titleText, items) {
  const section = document.createElement('div');
  section.className = 'section animate-in';
  
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = titleText;
  section.appendChild(title);
  
  const scroller = document.createElement('div');
  scroller.className = 'horizontal-scroller';
  scroller.style.scrollSnapType = 'x mandatory';
  scroller.style.paddingBottom = '10px';
  
  for (let c = 0; c < 5; c++) {
    const colItems = items.slice(c * 5, (c + 1) * 5);
    if (colItems.length === 0) break;

    const col = document.createElement('div');
    col.style.display = 'flex';
    col.style.flexDirection = 'column';
    col.style.gap = '8px';
    col.style.width = '85vw';
    col.style.maxWidth = '350px';
    col.style.flexShrink = '0';
    col.style.scrollSnapAlign = 'center';
    
    colItems.forEach(item => {
      const card = document.createElement('div');
      card.style.display = 'flex';
      card.style.alignItems = 'center';
      card.style.height = '48px'; // Smaller size
      card.style.cursor = 'pointer';
      card.style.background = 'transparent'; // Remove container background
      
      card.innerHTML = `
        <img src="${item.coverImage || item.image}" alt="${item.title || item.name}" style="height: 48px; width: 48px; object-fit: cover; border-radius: 4px;" />
        <div style="flex: 1; padding: 0 12px; font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right;">${item.title || item.name}</div>
        <i class="fa-solid fa-ellipsis-vertical" style="color: rgba(255,255,255,0.5); padding: 10px; font-size: 14px;" onclick="openTrackOptions(event, \`${item.id}\`)"></i>
      `;
      card.onclick = () => {
        if (item.audioUrl) openTrackDetail(item.id);
      };
      col.appendChild(card);
    });
    scroller.appendChild(col);
  }
  
  section.appendChild(scroller);
  return section;
}

// Create a horizontal scroll section with square cards (Spotify "Made for You" style)
function createSquareScrollerSection(title, items) {
  const section = document.createElement('div');
  section.className = 'section animate-in';
  
  const header = document.createElement('div');
  header.className = 'section-title';
  header.textContent = title;
  section.appendChild(header);
  
  const scroller = document.createElement('div');
  scroller.className = 'horizontal-scroller';
  
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'square-card';
    card.innerHTML = `
      <img src="${item.coverImage || item.image}" alt="${item.title || item.name}" class="square-cover" />
      <div class="square-title">${item.title || item.name}</div>
      <div class="square-subtitle">${item.reciterName || ''}</div>
    `;
    card.onclick = () => {
      if (item.audioUrl) openTrackDetail(item.id);
    };
    scroller.appendChild(card);
  });
  
  section.appendChild(scroller);
  return section;
}

// Create Reciter section (Spotify Artist style)
function createReciterSection(title, reciterList) {
  const section = document.createElement('div');
  section.className = 'section animate-in';
  
  const header = document.createElement('div');
  header.className = 'section-title';
  header.textContent = title;
  section.appendChild(header);
  
  const scroller = document.createElement('div');
  scroller.className = 'horizontal-scroller';
  
  reciterList.forEach(r => {
    const card = document.createElement('div');
    card.className = 'square-card';
    card.innerHTML = `
      <img src="${r.image}" alt="${r.name}" class="square-cover" style="border-radius: 50%;" />
      <div class="square-title" style="text-align: center;">${r.name}</div>
      <div class="square-subtitle" style="text-align: center;">\u0641\u0646\u0627\u0646</div>
    `;
    card.onclick = () => openArtistDetail(r.name);
    scroller.appendChild(card);
  });
  
  section.appendChild(scroller);
  return section;
}

// Audio Player Logic
const audioContext = new Audio();

audioContext.addEventListener('ended', () => {
  isPlaying = false;
  updatePlayButton();
});

audioContext.addEventListener('pause', () => {
  isPlaying = false;
  updatePlayButton();
});

audioContext.addEventListener('play', () => {
  isPlaying = true;
  updatePlayButton();
});

let queueList = [];
let queueIndex = 0;

// Translation dictionary for common English reciter names
const reciterNamesTranslations = {
  "basim karbalaei": "باسم الكربلائي",
  "basim_karbalaei": "باسم الكربلائي",
  "mulla basim": "باسم الكربلائي",
  "ammar al kinani": "عمار الكناني",
  "ammar_alkinani": "عمار الكناني",
  "qahtan al bdeiri": "قحطان البديري",
  "qahtan_al_bdeiri": "قحطان البديري",
  "muslim al waeli": "مسلم الوائلي",
  "muslim_al_waeli": "مسلم الوائلي",
  "ali al delfi": "علي الدلفي",
  "ali_delphi": "علي الدلفي",
  "ali_aldelfi": "علي الدلفي",
  "hussain faisal": "حسين فيصل",
  "hussein_faisal": "حسين فيصل",
  "mohammed al halfi": "محمد الحلفي",
  "mohamed_alhalfi": "محمد الحلفي",
  "hussain al akraf": "حسين الأكرف",
  "hussain_alakraf": "حسين الأكرف",
  "murtadha_harb": "مرتضى حرب",
  "murtadha harb": "مرتضى حرب",
  "sayed_faqid": "سيد فاقد الموسوي",
  "sayed_faqid_almousawi": "سيد فاقد الموسوي",
  "mustafa_alsudani": "مصطفى السوداني",
  "ali_bouhamad": "علي بوحمد",
  "mohammed_bujbara": "محمد بوجبارة",
  "ahmed_alsaeedi": "أحمد الساعدي",
  "mohammed_al_jnaid": "محمد الجنامي",
  "mohamed_aljanami": "محمد الجنامي"
};

function translateReciterName(name) {
  if (!name) return '\u0645\u062c\u0647\u0648\u0644';
  const cleanName = name.toLowerCase().trim();
  if (reciterNamesTranslations[cleanName]) {
    return reciterNamesTranslations[cleanName];
  }
  // If it's English, at least replace underscores with spaces and capitalize
  if (/^[a-z_ \-0-9]+$/i.test(name)) {
     return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
  return name;
}
let similarList = [];

// Player States
let isShuffle = false;
let isRepeat = false;
let isAutoplay = false;
let isLiked = false;

function toggleShuffle() {
  isShuffle = !isShuffle;
  const btn = document.getElementById('fp-shuffle-btn');
  if (btn) btn.style.color = isShuffle ? 'var(--accent)' : 'rgba(255,255,255,0.5)';
  
  if (isShuffle && queueList.length > 0) {
    // Shuffle remaining queue
    const remaining = queueList.slice(queueIndex + 1);
    remaining.sort(() => Math.random() - 0.5);
    queueList = [...queueList.slice(0, queueIndex + 1), ...remaining];
    updateQueueUI();
  }
}

function toggleRepeat() {
  isRepeat = !isRepeat;
  const btn = document.getElementById('fp-repeat-btn');
  if (btn) btn.style.color = isRepeat ? 'var(--accent)' : 'rgba(255,255,255,0.5)';
  audioContext.loop = isRepeat;
}

function toggleLike() {
  isLiked = !isLiked;
  const btn = document.getElementById('fp-like-btn');
  if (btn) {
    btn.className = isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    btn.style.color = isLiked ? 'var(--accent)' : 'white';
  }
}

function toggleAutoplay() {
  isAutoplay = !isAutoplay;
  const switchContainer = document.getElementById('fp-autoplay-switch');
  const knob = switchContainer.querySelector('.switch-knob');
  if (isAutoplay) {
    switchContainer.style.background = 'var(--accent)';
    knob.style.right = '2px';
  } else {
    switchContainer.style.background = 'rgba(255,255,255,0.2)';
    knob.style.right = '22px';
  }
}

function updateQueueUI() {
  const queueContainer = document.getElementById('fp-queue-list');
  if (!queueContainer) return;
  
  queueContainer.innerHTML = '';
  const upcomingQueue = [];
  for (let i = 1; i <= 5; i++) {
    if (queueIndex + i < queueList.length) {
      upcomingQueue.push(queueList[queueIndex + i]);
    }
  }
  
  upcomingQueue.forEach((p, index) => {
    const track = document.createElement('div');
    track.className = 'track-item';
    track.style.padding = '5px 0';
    track.innerHTML = `
      <img src="${p.coverImage}" class="track-img" style="width: 45px; height: 45px;" />
      <div class="track-info">
        <div class="track-title" style="font-size: 15px;">${p.title}</div>
        <div class="track-artist" style="font-size: 13px;">${p.reciterName}</div>
      </div>
      <i class="fa-solid fa-ellipsis-vertical" style="color: rgba(255,255,255,0.5); padding: 10px;" onclick="openTrackOptions(event, \`${p.id}\`)"></i>
    `;
    track.onclick = () => {
      queueIndex += (index + 1);
      playPoem(p, true);
    };
    queueContainer.appendChild(track);
  });
  
  if (upcomingQueue.length === 0) {
    queueContainer.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.5); padding: 10px;">\u0644\u0627 \u064a\u0648\u062c\u062f \u0645\u0642\u0627\u0637\u0639 \u062a\u0627\u0644\u064a\u0629 \u0641\u064a \u0627\u0644\u0642\u0627\u0626\u0645\u0629</div>';
  }
}

function playPoem(poem, fromQueueNavigation = false) {
  if (!poem.audioUrl) {
    alert('\u0639\u0630\u0631\u0627\u064b\u060c \u0647\u0630\u0627 \u0627\u0644\u0645\u0642\u0637\u0639 \u0644\u0627 \u064a\u062d\u062a\u0648\u064a \u0639\u0644\u0649 \u0631\u0627\u0628\u0637 \u0635\u0648\u062a\u064a.');
    return;
  }

  currentPoem = poem;
  
  // Build queue context if this is a fresh play
  if (!fromQueueNavigation) {
    const idx = globalPoems.findIndex(p => p.audioUrl === poem.audioUrl);
    if (idx !== -1) {
      queueList = globalPoems;
      queueIndex = idx;
    } else {
      queueList = [poem, ...globalPoems];
      queueIndex = 0;
    }
    // Update similar list only on fresh play
    similarList = [...globalPoems].filter(p => p.audioUrl !== poem.audioUrl).sort(() => 0.5 - Math.random()).slice(0, 5);
  }
  
  // Update Mini Player only if full player is not open
  const player = document.getElementById('mini-player');
  const fullPlayer = document.getElementById('full-player-view');
  if (!fullPlayer || !fullPlayer.classList.contains('open')) {
    player.style.display = 'flex';
    player.classList.add('active');
  }

  document.getElementById('mp-cover').src = poem.coverImage;
  document.getElementById('mp-title').textContent = poem.title;
  document.getElementById('mp-reciter').textContent = poem.reciterName;
  
  // Update Full Player
  document.getElementById('fp-cover').src = poem.coverImage;
  document.getElementById('fp-title').textContent = poem.title;
  document.getElementById('fp-artist').textContent = poem.reciterName;
  
  const fpBg = document.getElementById('fp-bg');
  if (fpBg) {
    fpBg.style.backgroundImage = `url('${poem.coverImage}')`;
  }

  // Wire up Full Player Like button
  const likeBtn = document.getElementById('fp-like-btn');
  if (likeBtn) {
    const isLiked = LibraryStore.likes.includes(poem.id);
    likeBtn.className = isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    likeBtn.style.color = isLiked ? '#E91E63' : 'white';
    
    likeBtn.onclick = () => {
      const liked = LibraryStore.toggleLike(poem.id);
      likeBtn.className = liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
      likeBtn.style.color = liked ? '#E91E63' : 'white';
      likeBtn.style.transform = 'scale(1.2)';
      setTimeout(() => likeBtn.style.transform = 'scale(1)', 200);
    };
  }

    // Wire up Full Player Download button
  const dlBtn = document.getElementById('fp-download-btn');
  if (dlBtn) {
    const isDl = LibraryStore.downloads.includes(poem.id);
    dlBtn.style.color = isDl ? '#4CAF50' : 'white';
    
    dlBtn.onclick = async () => {
      const originalHtml = dlBtn.innerHTML;
      dlBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      const downloaded = await LibraryStore.toggleDownload(poem.id);
      dlBtn.innerHTML = originalHtml;
      dlBtn.style.color = downloaded ? '#4CAF50' : 'white';
      dlBtn.style.transform = 'scale(1.2)';
      setTimeout(() => dlBtn.style.transform = 'scale(1)', 200);
    };
  }

  // Wire up Full Player Playlist button
  const plBtn = document.getElementById('fp-playlist-btn');
  if (plBtn) {
    plBtn.onclick = () => {
      window.openPlaylistModal(poem.id);
      plBtn.style.transform = 'scale(1.2)';
      setTimeout(() => plBtn.style.transform = 'scale(1)', 200);
    };
  }
  
  // Update Next Track info (Queue and Similar)
  const similarContainer = document.getElementById('fp-similar-list');
  const queueContainer = document.getElementById('fp-queue-list');
  
  if (similarContainer) {
    similarContainer.innerHTML = '';
    similarList.forEach(t => {
      const card = document.createElement('div');
      card.className = 'album-card reciter-card';
      card.style.width = '32vw';
      card.style.maxWidth = '140px';
      card.style.flexShrink = '0';
      
      card.innerHTML = `
        <img src="${t.coverImage}" style="width: 100%; aspect-ratio: 1; border-radius: 8px; object-fit: cover;" />
        <div style="font-size: 14px; font-weight: bold; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right;">${t.title}</div>
        <div style="font-size: 13px; color: rgba(255,255,255,0.6); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right;">${t.reciterName}</div>
      `;
      card.onclick = () => openTrackDetail(t);
      similarContainer.appendChild(card);
    });
  }

  if (queueContainer) {
    updateQueueUI();
  }

  audioContext.src = poem.audioUrl;
  audioContext.play().catch(err => console.error('Audio playback failed:', err));
}

window.openTrackDetail = function(poemId) {
  const poem = globalPoems.find(p => p.id === poemId);
  if (poem) {
    playPoem(poem);
  }
};

window.openTrackOptions = function(event, poemId) {
  history.pushState({ overlay: 'track-options' }, '');
  event.stopPropagation();
  const poem = globalPoems.find(p => p.id === poemId);
  if (!poem) return;
  
  const modal = document.getElementById('track-options-modal');
  const sheet = document.getElementById('track-options-sheet');
  
  // Populate Data
  document.getElementById('track-options-img').src = poem.coverImage || poem.image || '';
  document.getElementById('track-options-title').textContent = poem.title || poem.name || 'مجهول';
  document.getElementById('track-options-artist').textContent = poem.reciterName || 'مجهول';
  
  // Like Button
  const isLiked = LibraryStore.likes.includes(poem.id);
  const likeIcon = document.getElementById('opt-like-icon');
  likeIcon.className = isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
  likeIcon.style.color = isLiked ? '#E91E63' : 'white';
  document.getElementById('opt-like').onclick = (e) => {
    e.stopPropagation();
    LibraryStore.toggleLike(poem.id);
    closeTrackOptions(e);
  };
  
  // Playlist Button
  document.getElementById('opt-playlist').onclick = (e) => {
    e.stopPropagation();
    closeTrackOptions(e);
    window.openPlaylistModal(poem.id);
  };
  
  // Download Button
  const isDl = LibraryStore.downloads.includes(poem.id);
  const dlIcon = document.getElementById('opt-download-icon');
  dlIcon.style.color = isDl ? '#4CAF50' : 'white';
  document.getElementById('opt-download').onclick = async (e) => {
    e.stopPropagation();
    const icon = document.getElementById('opt-download-icon');
    if (icon) icon.className = 'fa-solid fa-spinner fa-spin';
    await LibraryStore.toggleDownload(poem.id);
    closeTrackOptions(e);
  };
  
  // Artist Button
  document.getElementById('opt-artist').onclick = (e) => {
    e.stopPropagation();
    closeTrackOptions(e);
    if(window.openArtistDetail) window.openArtistDetail(poem.reciterName);
  };

  // Share Button
  document.getElementById('opt-share').onclick = (e) => {
    e.stopPropagation();
    closeTrackOptions(e);
    if (navigator.share) {
      navigator.share({
        title: poem.title,
        text: 'استمع إلى ' + poem.title + ' بصوت ' + poem.reciterName,
        url: window.location.href
      });
    } else {
      alert('تم نسخ الرابط!');
    }
  };
  
  // Show animation
  modal.style.display = 'flex';
  setTimeout(() => {
    modal.style.opacity = '1';
    sheet.style.transform = 'translateY(0)';
  }, 10);
};

window.closeTrackOptions = function(event, fromPopState = false) {
  if (!fromPopState) { history.back(); return; }
  if (event) event.stopPropagation();
  const modal = document.getElementById('track-options-modal');
  const sheet = document.getElementById('track-options-sheet');
  
  sheet.style.transform = 'translateY(100%)';
  modal.style.opacity = '0';
  setTimeout(() => {
    modal.style.display = 'none';
  }, 300);
};

let isDraggingProgress = false;
audioContext.addEventListener('timeupdate', () => {
  if (audioContext.duration && isFinite(audioContext.duration)) {
    const progress = (audioContext.currentTime / audioContext.duration) * 100;
    
    // Update Full Player Slider
    const fpProgress = document.getElementById('fp-progress');
    if (!isDraggingProgress && fpProgress) {
      fpProgress.value = progress;
      fpProgress.style.background = `linear-gradient(to left, var(--accent) ${progress}%, rgba(255,255,255,0.2) ${progress}%)`;
      document.getElementById('fp-current-time').textContent = formatTime(audioContext.currentTime);
    }
    document.getElementById('fp-total-time').textContent = formatTime(audioContext.duration);
    
    // Update Mini Player Circular Progress
    const mpRing = document.getElementById('mp-progress-ring');
    if (mpRing) {
      mpRing.style.background = `conic-gradient(var(--accent) ${progress}%, rgba(255,255,255,0.1) 0%)`;
    }
  }
});

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

window.togglePlay = function(event) {
  if (event) event.stopPropagation();
  if (!currentPoem || !audioContext.src) return;
  if (audioContext.paused) {
    audioContext.play().catch(err => console.error(err));
  } else {
    audioContext.pause();
  }
};

function updatePlayButton() {
  const btn = document.getElementById('mp-play-btn');
  if (btn) btn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play" style="margin-left: 3px;"></i>';
  
  const fpBtn = document.getElementById('fp-play-btn');
  if (fpBtn) fpBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play" style="margin-left: 4px;"></i>';
}

window.seekAudio = function(value) {
  if (audioContext.duration && isFinite(audioContext.duration)) {
    audioContext.currentTime = (value / 100) * audioContext.duration;
  }
};

window.playNext = function() {
  if (isShuffle && queueList.length > 0) {
    queueIndex = Math.floor(Math.random() * queueList.length);
    playPoem(queueList[queueIndex], true);
  } else if (queueIndex < queueList.length - 1) {
    queueIndex++;
    playPoem(queueList[queueIndex], true);
  } else {
    // If end of queue, loop back to start
    if (queueList.length > 0) {
      queueIndex = 0;
      playPoem(queueList[queueIndex], true);
    }
  }
};

window.playPrev = function() {
  if (audioContext.currentTime > 3) {
    audioContext.currentTime = 0;
  } else if (queueIndex > 0) {
    queueIndex--;
    playPoem(queueList[queueIndex], true);
  } else {
    audioContext.currentTime = 0;
  }
};

window.toggleShuffle = function() {
  isShuffle = !isShuffle;
  const btn = document.getElementById('fp-shuffle-btn');
  if (btn) btn.style.color = isShuffle ? 'var(--accent)' : 'rgba(255,255,255,0.5)';
};

window.toggleRepeat = function() {
  isRepeat = !isRepeat;
  const btn = document.getElementById('fp-repeat-btn');
  if (btn) btn.style.color = isRepeat ? 'var(--accent)' : 'rgba(255,255,255,0.5)';
};

window.closeFullPlayer = function(fromPopState = false) {
  if (!fromPopState) { history.back(); return; }
  document.getElementById('full-player-view').classList.remove('open');
  const miniPlayer = document.getElementById('mini-player');
  if (currentPoem) {
    miniPlayer.style.display = 'flex';
    miniPlayer.classList.add('active');
  }
};

function openFullPlayer() {
  history.pushState({ overlay: 'full-player' }, '');
  if (!currentPoem) return;
  const fp = document.getElementById('full-player-view');
  fp.classList.add('open');
  // hide mini player while full is open
  document.getElementById('mini-player').classList.remove('active');
}

// Open full player when clicking mini player
const miniPlayerEl = document.getElementById('mini-player');
if (miniPlayerEl) {
  miniPlayerEl.addEventListener('click', (e) => {
    // Don't open if clicking buttons inside
    if (e.target.closest('button') || e.target.closest('.control-btn') || e.target.closest('.mp-progress-ring')) return;
    openFullPlayer();
  });
}

const fpProgressElement = document.getElementById('fp-progress');
if (fpProgressElement) {
  fpProgressElement.addEventListener('input', () => isDraggingProgress = true);
  fpProgressElement.addEventListener('change', (e) => {
    isDraggingProgress = false;
    seekAudio(e.target.value);
  });
}

// === RESTORED LIBRARY VIEWS ===
window.renderLibraryContent = function(filter = 'all') {
  const container = document.getElementById('library-content');
  container.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'library-grid animate-in';

  let items = [
    { id: 'likes', title: '\u0627\u0644\u0645\u0642\u0627\u0637\u0639 \u0627\u0644\u0645\u0641\u0636\u0644\u0629', subtitle: `${LibraryStore.likes.length} \u0645\u0642\u0637\u0639`, icon: 'fa-heart' },
    { id: 'downloads', title: '\u0627\u0644\u0645\u0642\u0627\u0637\u0639 \u0627\u0644\u0645\u062d\u0645\u0644\u0629', subtitle: `${LibraryStore.downloads.length} \u0645\u0642\u0637\u0639 \u0641\u064a \u0627\u0644\u062c\u0647\u0627\u0632`, icon: 'fa-download' },
    { id: 'playlists', title: '\u0642\u0648\u0627\u0626\u0645 \u0627\u0644\u062a\u0634\u063a\u064a\u0644', subtitle: `${LibraryStore.playlists.length} \u0642\u0627\u0626\u0645\u0629`, icon: 'fa-list' },
    { id: 'artists', title: '\u0627\u0644\u0631\u0648\u0627\u062f\u064a\u062f', subtitle: `${globalReciters.length} \u0631\u0627\u062f\u0648\u062f`, icon: 'fa-user' }
  ];

  if (filter !== 'all') {
    items = items.filter(item => item.id === filter);
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'library-card';
    card.innerHTML = `
      <i class="fa-solid ${item.icon}"></i>
      <div class="library-card-title">${item.title}</div>
      <div class="library-card-subtitle">${item.subtitle}</div>
    `;
    card.onclick = () => openPlaylistDetail(item.id, item.title, item.subtitle);
    grid.appendChild(card);
  });

  // If filter is playlists or all, show custom playlists
  if (filter === 'all' || filter === 'playlists') {
    LibraryStore.playlists.forEach(pl => {
      const card = document.createElement('div');
      card.className = 'library-card';
      card.innerHTML = `
        <i class="fa-solid fa-music"></i>
        <div class="library-card-title">${pl.name}</div>
        <div class="library-card-subtitle">${pl.tracks.length} \u0645\u0642\u0637\u0639</div>
      `;
      card.onclick = () => openPlaylistDetail(`playlist_${pl.id}`, pl.name, `${pl.tracks.length} \u0645\u0642\u0637\u0639`);
      grid.appendChild(card);
    });
  }

  container.appendChild(grid);
};

window.promptCreatePlaylist = function() {
  history.pushState({ overlay: 'create-playlist' }, '');
  document.getElementById('new-playlist-name').value = '';
  document.getElementById('create-playlist-modal').style.display = 'flex';
};

window.submitCreatePlaylist = function() {
  const input = document.getElementById('new-playlist-name');
  const name = input.value.trim();
  if (name) {
    LibraryStore.addPlaylist(name);
    document.getElementById('create-playlist-modal').style.display = 'none';
    const activeChip = document.querySelector('.filter-chip.active');
    if (activeChip && document.getElementById('library-view').style.display !== 'none') {
      renderLibraryContent(activeChip.dataset.filter);
    }
    if (document.getElementById('playlist-modal').style.display === 'flex') {
      const currentTrack = currentPoem ? currentPoem.id : null;
      if (currentTrack) window.openPlaylistModal(currentTrack);
    }
  } else {
    input.focus();
  }
};

window.openPlaylistModal = function(trackId) {
  history.pushState({ overlay: 'playlist-modal' }, '');
  const modal = document.getElementById('playlist-modal');
  const list = document.getElementById('playlist-modal-list');
  list.innerHTML = '';
  
  if (LibraryStore.playlists.length === 0) {
    list.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">\u0644\u0627 \u062a\u0648\u062c\u062f \u0642\u0648\u0627\u0626\u0645 \u062a\u0634\u063a\u064a\u0644. \u0642\u0645 \u0628\u0625\u0646\u0634\u0627\u0621 \u0648\u0627\u062d\u062f\u0629 \u0623\u0648\u0644\u0627\u064b.</div>';
  } else {
    LibraryStore.playlists.forEach(pl => {
      const item = document.createElement('div');
      item.style.padding = '12px';
      item.style.borderBottom = '1px solid #333';
      item.style.cursor = 'pointer';
      item.innerHTML = `
        <i class="fa-solid fa-music" style="margin-left: 10px; color: var(--accent);"></i>
        ${pl.name} <span style="color: var(--text-secondary); font-size: 12px; float: left;">${pl.tracks.length} \u0645\u0642\u0637\u0639</span>
      `;
      item.onclick = () => {
        if (LibraryStore.addTrackToPlaylist(pl.id, trackId)) {
          modal.style.display = 'none';
          const btn = document.getElementById('fp-playlist-btn');
          if (btn) {
            btn.style.color = '#FFA500';
            setTimeout(() => btn.style.color = 'white', 1000);
          }
        } else {
          alert('\u0627\u0644\u0645\u0642\u0637\u0639 \u0645\u0648\u062c\u0648\u062f \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064a \u0647\u0630\u0647 \u0627\u0644\u0642\u0627\u0626\u0645\u0629!');
        }
      };
      list.appendChild(item);
    });
  }
  modal.style.display = 'flex';
};

window.openPlaylistDetail = function(id, title, subtitle) {
  document.getElementById('library-view').style.display = 'none';
  const detailView = document.getElementById('playlist-detail-view');
  detailView.style.display = 'block';
  
  document.getElementById('playlist-title').textContent = title;
  document.getElementById('playlist-subtitle').textContent = subtitle;
  
  const tracksContainer = document.getElementById('playlist-tracks');
  tracksContainer.innerHTML = '';
  
  if (id === 'playlists') {
    tracksContainer.className = 'library-grid';
    LibraryStore.playlists.forEach(pl => {
      const card = document.createElement('div');
      card.className = 'album-card animate-in';
      card.innerHTML = `
        <img src="https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500" class="album-cover" />
        <div class="album-title">${pl.name}</div>
        <div class="square-subtitle" style="text-align: center;">${pl.tracks.length} \u0645\u0642\u0637\u0639</div>
      `;
      card.onclick = () => openPlaylistDetail(`playlist_${pl.id}`, pl.name, `${pl.tracks.length} \u0645\u0642\u0637\u0639`);
      tracksContainer.appendChild(card);
    });
  } else if (id === 'artists') {
    tracksContainer.className = 'library-grid';
    globalReciters.forEach(r => {
      const card = document.createElement('div');
      card.className = 'album-card animate-in';
      card.innerHTML = `
        <img src="${r.image}" class="album-cover" style="border-radius: 50%;" />
        <div class="album-title">${r.name}</div>
        <div class="square-subtitle" style="text-align: center;">\u0641\u0646\u0627\u0646</div>
      `;
      card.onclick = () => openArtistDetail(r.name);
      tracksContainer.appendChild(card);
    });
  } else {
    tracksContainer.className = 'track-list';
    let listPoems = [];
    if (id === 'likes') {
      listPoems = globalPoems.filter(p => LibraryStore.likes.includes(p.id));
    } else if (id === 'downloads') {
      listPoems = globalPoems.filter(p => LibraryStore.downloads.includes(p.id));
    } else if (id && id.toString().startsWith('playlist_')) {
      const plId = id.split('_')[1];
      const pl = LibraryStore.playlists.find(x => x.id === plId);
      if (pl) listPoems = globalPoems.filter(p => pl.tracks.includes(p.id));
    } else {
      listPoems = [...globalPoems].sort(() => 0.5 - Math.random()).slice(0, 15);
    }
    
    if (listPoems.length === 0) {
      tracksContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary); margin-top: 40px;">\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0642\u0627\u0637\u0639 \u0647\u0646\u0627 \u0628\u0639\u062f</div>';
    } else {
      listPoems.forEach((track, index) => {
        const el = document.createElement('div');
        el.className = 'track-item animate-in';
        el.innerHTML = `
          <div class="track-number">${index + 1}</div>
          <img src="${track.coverImage || track.image}" class="track-img" />
          <div class="track-info">
            <div class="track-title">${track.title || track.name}</div>
            <div class="track-artist">${track.reciterName || '\u0645\u062c\u0647\u0648\u0644'}</div>
          </div>
          <i class="fa-solid fa-ellipsis-vertical" style="color: var(--text-secondary); padding: 10px;" onclick="openTrackOptions(event, \`${track.id}\`)"></i>
        `;
        el.onclick = () => openTrackDetail(track);
        tracksContainer.appendChild(el);
      });
    }
  }
};

// === RESTORED SEARCH VIEWS ===
function getCategoryFirstImage(categoryTitle) {
  let found = globalPoems.find(p => p.title.includes(categoryTitle) || p.category === categoryTitle);
  if (!found && categoryTitle === '\u0639\u0632\u0627\u0621') found = globalPoems.find(p => p.title.includes('\u0644\u0637\u0645') || p.title.includes('\u0634\u0648\u0631'));
  if (!found && categoryTitle === '\u0645\u0648\u0627\u0644\u064a\u062f') found = globalPoems.find(p => p.title.includes('\u0645\u0648\u0644\u062f') || p.title.includes('\u0645\u064a\u0644\u0627\u062f') || p.title.includes('\u0641\u0631\u062d'));
  if (!found && categoryTitle === '\u0623\u062f\u0639\u064a\u0629') found = globalPoems.find(p => p.title.includes('\u062f\u0639\u0627\u0621') || p.title.includes('\u0632\u064a\u0627\u0631\u0629') || p.title.includes('\u0645\u0646\u0627\u062c\u0627\u0629'));
  return found ? found.coverImage : 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500';
}

window.renderSearchContent = function() {
  const searchInput = document.getElementById('main-search-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase();
      const resultsContainer = document.getElementById('search-results');
      if (q.length > 0) {
        document.getElementById('genre-grid').style.display = 'none';
        const titleEl = document.getElementById('search-section-title');
        if (titleEl) titleEl.style.display = 'none';
        resultsContainer.style.display = 'block';
        resultsContainer.innerHTML = '';
        
        const qWords = q.split(' ').filter(w => w.trim() !== '');
        const results = globalPoems.filter(p => {
          const textToSearch = (p.title + ' ' + p.reciterName).toLowerCase();
          return qWords.every(word => textToSearch.includes(word));
        });
        
        if (results.length > 0) {
          results.forEach(track => {
            const el = document.createElement('div');
            el.className = 'track-item animate-in';
            el.innerHTML = `
              <img src="${track.coverImage || track.image}" class="track-img" />
              <div class="track-info">
                <div class="track-title">${track.title || track.name}</div>
                <div class="track-artist">${track.reciterName || '\u0645\u062c\u0647\u0648\u0644'}</div>
              </div>
              <i class="fa-solid fa-ellipsis-vertical" style="color: var(--text-secondary); padding: 10px;" onclick="openTrackOptions(event, \`${track.id}\`)"></i>
            `;
            el.onclick = () => openTrackDetail(track);
            resultsContainer.appendChild(el);
          });
        } else {
          resultsContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-secondary);">\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0646\u062a\u0627\u0626\u062c</div>';
        }
      } else {
        document.getElementById('genre-grid').style.display = 'grid';
        const titleEl = document.getElementById('search-section-title');
        if (titleEl) titleEl.style.display = 'block';
        resultsContainer.style.display = 'none';
      }
    };
  }

  const catContainer = document.getElementById('genre-grid');
  if (catContainer) {
    catContainer.innerHTML = '';
    const categories = [
      { id: 'latmiyat', title: 'عزاء', color: '#E13300' },
      { id: 'mawalid', title: 'مواليد', color: '#1E3264' },
      { id: 'adeya', title: 'أدعية', color: '#E8115B' },
      { id: 'quran', title: 'قرآن كريم', color: '#148A08' },
      { id: 'shor', title: 'شور', color: '#8C1932' },
      { id: 'nae', title: 'نعي', color: '#006450' },
      { id: 'ziyarat', title: 'زيارات', color: '#8400E7' },
      { id: 'husseini', title: 'قصائد حسينية', color: '#E91429' }
    ];
    
    categories.forEach(cat => {
      const card = document.createElement('div');
      card.className = 'genre-card';
      card.style.backgroundColor = cat.color;
      const imgUrl = getCategoryFirstImage(cat.title);
      card.innerHTML = `
        <div class="genre-card-title">${cat.title}</div>
        <img src="${imgUrl}" class="genre-card-img" onerror="this.src='https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=200'" />
      `;
      card.onclick = () => openCategoryDetail(cat.title, imgUrl);
      catContainer.appendChild(card);
    });
  }
};

window.openCategoryDetail = function(categoryName, bgImage) {
  history.pushState({ overlay: 'category-view' }, '');
  document.getElementById('search-view').style.display = 'none';
  const cv = document.getElementById('category-view');
  if (cv) {
    cv.style.display = 'block';
    const nameEl = document.getElementById('category-detail-name');
    if (nameEl) nameEl.textContent = categoryName;
    const imgEl = document.getElementById('category-detail-image');
    if (imgEl) imgEl.src = bgImage;
    const gradientEl = document.getElementById('category-detail-gradient');
    if (gradientEl) gradientEl.style.display = 'block';
    
    const tc = document.getElementById('category-tracks');
    tc.innerHTML = '';
    
    let filtered = [];
    if (categoryName === 'عزاء') filtered = globalPoems.filter(p => p.title.includes('لطم') || p.title.includes('شور') || p.title.includes('عزاء') || p.category === 'عزاء');
    else if (categoryName === 'مواليد') filtered = globalPoems.filter(p => p.title.includes('مولد') || p.title.includes('ميلاد') || p.title.includes('فرح') || p.title.includes('مواليد'));
    else if (categoryName === 'أدعية') filtered = globalPoems.filter(p => p.title.includes('دعاء') || p.title.includes('مناجاة'));
    else if (categoryName === 'زيارات') filtered = globalPoems.filter(p => p.title.includes('زيار'));
    else if (categoryName === 'قرآن كريم') filtered = globalPoems.filter(p => p.title.includes('قرآن') || p.title.includes('سورة') || p.title.includes('تلاوة'));
    else if (categoryName === 'نعي') filtered = globalPoems.filter(p => p.title.includes('نعي') || p.title.includes('مجلس'));
    else if (categoryName === 'شور') filtered = globalPoems.filter(p => p.title.includes('شور'));
    else if (categoryName === 'قصائد حسينية') filtered = globalPoems.filter(p => p.title.includes('قصيد') || p.title.includes('حسين'));
    else filtered = globalPoems.filter(p => p.title.includes(categoryName));
    
    if (filtered.length === 0) filtered = [...globalPoems].sort(() => 0.5 - Math.random()).slice(0, 10);
    
    filtered.forEach((track, index) => {
      const el = document.createElement('div');
      el.className = 'track-item animate-in';
      el.innerHTML = `
        <div class="track-number">${index + 1}</div>
        <img src="${track.coverImage || track.image}" class="track-img" />
        <div class="track-info">
          <div class="track-title">${track.title || track.name}</div>
          <div class="track-artist">${track.reciterName || '\u0645\u062c\u0647\u0648\u0644'}</div>
        </div>
        <i class="fa-solid fa-ellipsis-vertical" style="color: var(--text-secondary); padding: 10px;" onclick="openTrackOptions(event, \`${track.id}\`)"></i>
      `;
      el.onclick = () => openTrackDetail(track);
      tc.appendChild(el);
    });
  }
};

// === RESTORED NAVIGATION ===
window.goHome = function() {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.getElementById('home-view').style.display = 'block';
  document.querySelector('.main-container').scrollTo(0, 0);
  document.querySelectorAll('.nav-item').forEach((n, i) => {
    if (i === 0) n.classList.add('active'); else n.classList.remove('active');
  });
};

window.goSearch = function() {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.getElementById('search-view').style.display = 'block';
  document.querySelector('.main-container').scrollTo(0, 0);
  document.querySelectorAll('.nav-item').forEach((n, i) => {
    if (i === 1) n.classList.add('active'); else n.classList.remove('active');
  });
  renderSearchContent();
};

window.goLibrary = function() {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.getElementById('library-view').style.display = 'block';
  document.querySelector('.main-container').scrollTo(0, 0);
  document.querySelectorAll('.nav-item').forEach((n, i) => {
    if (i === 2) n.classList.add('active'); else n.classList.remove('active');
  });
  renderLibraryContent(document.querySelector('.filter-chip.active')?.dataset.filter || 'all');
};

window.openArtistDetail = function(artistName) {
  history.pushState({ overlay: 'artist-view' }, '');
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.getElementById('artist-view').style.display = 'block';
  document.querySelector('.main-container').scrollTo(0, 0);
  
  const artist = globalReciters.find(r => r.name === artistName);
  const artistTracks = globalPoems.filter(p => p.reciterName === artistName);
  
  document.getElementById('artist-detail-name').textContent = artistName;
  document.getElementById('artist-detail-stats').textContent = artistTracks.length + ' مقطع مسموع';
  
  if (artist && artist.image) {
    document.getElementById('artist-detail-image').src = artist.image;
  } else if (artistTracks.length > 0) {
    document.getElementById('artist-detail-image').src = artistTracks[0].coverImage;
  }
  
  const trackListContainer = document.getElementById('artist-tracks');
  trackListContainer.innerHTML = '';
  
  if (artistTracks.length === 0) {
    trackListContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary); margin-top: 40px;">لا توجد مقاطع لهذا الرادود</div>';
  } else {
    artistTracks.forEach((track, index) => {
      const el = document.createElement('div');
      el.className = 'track-item animate-in';
      el.innerHTML = `
        <div class="track-number">${index + 1}</div>
        <img src="${track.coverImage || track.image}" class="track-img" />
        <div class="track-info">
          <div class="track-title">${track.title || track.name}</div>
          <div class="track-artist">${track.reciterName || 'مجهول'}</div>
        </div>
        <i class="fa-solid fa-ellipsis-vertical" style="color: var(--text-secondary); padding: 10px;" onclick="openTrackOptions(event, \`${track.id}\`)"></i>
      `;
      el.onclick = () => openTrackDetail(track);
      trackListContainer.appendChild(el);
    });
  }
  
  const playAllBtn = document.getElementById('artist-play-all');
  if(playAllBtn) {
    playAllBtn.onclick = () => {
      if (artistTracks.length > 0) {
        openTrackDetail(artistTracks[0]);
      }
    };
  }
};

window.goProfile = function() {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.getElementById('profile-view').style.display = 'block';
  document.querySelector('.main-container').scrollTo(0, 0);
  document.querySelectorAll('.nav-item').forEach((n, i) => {
    if (i === 3) n.classList.add('active'); else n.classList.remove('active');
  });
};

// Initialize listeners for library filters
const filterChips = document.querySelectorAll('.filter-chip');
filterChips.forEach(chip => {
  chip.onclick = () => {
    filterChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderLibraryContent(chip.dataset.filter);
  };
});

// Boot App
fetchAppData();

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('SW registered: ', registration);
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}

window.addEventListener('popstate', (e) => {
  const trackOpts = document.getElementById('track-options-modal');
  if (trackOpts && trackOpts.style.display !== 'none') {
    closeTrackOptions(null, true);
    return;
  }
  
  const createPl = document.getElementById('create-playlist-modal');
  if (createPl && createPl.style.display !== 'none') {
    createPl.style.display = 'none';
    return;
  }
  
  const plModal = document.getElementById('playlist-modal');
  if (plModal && plModal.style.display !== 'none') {
    if(typeof closePlaylistModal === 'function') closePlaylistModal(true);
    else plModal.style.display = 'none';
    return;
  }
  
  const fullPlayer = document.getElementById('full-player-view');
  if (fullPlayer && fullPlayer.classList.contains('open')) {
    closeFullPlayer(true);
    return;
  }
  
  const artistView = document.getElementById('artist-view');
  if (artistView && artistView.style.display === 'block') {
    artistView.style.display = 'none';
    return;
  }
  
  const tdView = document.getElementById('track-detail-view');
  if (tdView && tdView.style.display === 'block') {
    tdView.style.display = 'none';
    return;
  }
  
  const catView = document.getElementById('category-view');
  if (catView && catView.style.display === 'block') {
    catView.style.display = 'none';
    document.getElementById('search-view').style.display = 'block';
    return;
  }
});

window.openTrackDetail = function(poem) {
  history.pushState({ overlay: 'track-detail' }, '');
  const tdView = document.getElementById('track-detail-view');
  if (tdView) tdView.style.display = 'block';
  
  document.getElementById('td-cover').src = poem.coverImage || poem.image;
  document.getElementById('td-title').textContent = poem.title;
  const artistEl = document.getElementById('td-artist');
  artistEl.textContent = poem.reciterName || 'مجهول';
  artistEl.onclick = () => openArtistDetail(poem.reciterName);
  
  const playBtn = document.getElementById('td-play-btn');
  playBtn.onclick = () => {
    playPoem(poem);
  };
  
  const similarContainer = document.getElementById('td-similar-list');
  similarContainer.innerHTML = '';
  const similar = [...globalPoems].filter(p => p.id !== poem.id && (p.reciterName === poem.reciterName || p.category === poem.category)).sort(() => 0.5 - Math.random()).slice(0, 5);
  if (similar.length === 0) similar.push(...[...globalPoems].filter(p => p.id !== poem.id).slice(0, 5));
  
  similar.forEach(track => {
    const el = document.createElement('div');
    el.className = 'track-item animate-in';
    el.innerHTML = `
      <img src="${track.coverImage || track.image}" class="track-img" />
      <div class="track-info">
        <div class="track-title">${track.title || track.name}</div>
        <div class="track-artist">${track.reciterName || 'مجهول'}</div>
      </div>
      <i class="fa-solid fa-ellipsis-vertical" style="color: rgba(255,255,255,0.5); padding: 10px;" onclick="openTrackOptions(event, '${track.id}')"></i>
    `;
    el.onclick = () => {
      openTrackDetail(track);
    };
    similarContainer.appendChild(el);
  });
};
