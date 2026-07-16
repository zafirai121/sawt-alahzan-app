import { supabase } from './supabaseClient.js';
import Hls from 'hls.js';

// ─── HLS Player ───────────────────────────────────────────────
let hlsInstance = null;

function loadAndPlay(url) {
  // Destroy any existing HLS instance
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  const isHLS = url && (url.includes('.m3u8') || url.includes('m3u8'));

  if (isHLS) {
    if (Hls.isSupported()) {
      // Use hls.js for adaptive streaming
      hlsInstance = new Hls({
        maxBufferLength: 30,           // buffer 30s ahead
        maxMaxBufferLength: 120,       // max 120s buffer
        lowLatencyMode: false,
        startLevel: -1,                // auto-select quality
        abrEwmaDefaultEstimate: 500000 // assume 500Kbps initially
      });
      hlsInstance.loadSource(url);
      hlsInstance.attachMedia(audioContext);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        audioContext.play().catch(err => console.error('HLS play error:', err));
      });
      hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error('Fatal HLS error:', data.type, data.details);
          // Fallback to direct src
          hlsInstance.destroy();
          hlsInstance = null;
          audioContext.src = url;
          audioContext.play().catch(e => console.error(e));
        }
      });
    } else if (audioContext.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari has native HLS support
      audioContext.src = url;
      audioContext.play().catch(err => console.error('Native HLS play error:', err));
    } else {
      console.warn('HLS not supported on this browser');
    }
  } else {
    // Regular MP3/M4A – use direct src
    audioContext.src = url;
    audioContext.play().catch(err => console.error('Audio play error:', err));
  }
}

// ─── AUTH STATE ───────────────────────────────────────────────
let currentUser = null;
let isAuthMode = 'login'; // 'login' | 'signup'

async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user ?? null;

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null;
    updateProfileUI();
    if (currentUser) syncLikesFromSupabase();
  });

  // Show auth modal only on first visit (no session and no "skipped" flag)
  if (!currentUser && !localStorage.getItem('sawt_auth_skipped')) {
    setTimeout(() => openAuthModal(), 800);
  }

  updateProfileUI();
  if (currentUser) {
    syncLikesFromSupabase();
    syncPlaylistsFromSupabase();
  }
}

function updateProfileUI() {
  const nameEl = document.getElementById('profile-display-name');
  const emailEl = document.getElementById('profile-email');
  const statusEl = document.getElementById('profile-status-badge');
  const guestSection = document.getElementById('profile-guest-section');
  const logoutSection = document.getElementById('profile-logout-section');
  const greetingEl = document.getElementById('home-greeting');
  const headerAvatarEl = document.getElementById('header-avatar');
  const profileAvatarEl = document.getElementById('profile-avatar-img');

  if (currentUser) {
    const name = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'مستخدم';
    const avatarUrl = currentUser.user_metadata?.avatar_url
      || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=E8B86D&color=121212&bold=true&size=200`;

    if (nameEl) nameEl.textContent = name;
    if (emailEl) emailEl.textContent = currentUser.email;
    if (statusEl) statusEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#4CAF50;"></i> حساب مفعل';
    if (guestSection) guestSection.style.display = 'none';
    if (logoutSection) logoutSection.style.display = 'block';
    
    // Update avatar images
    if (headerAvatarEl) { headerAvatarEl.src = avatarUrl; headerAvatarEl.style.display = 'block'; }
    if (profileAvatarEl) profileAvatarEl.src = avatarUrl;
  } else {
    if (nameEl) nameEl.textContent = 'ضيف';
    if (emailEl) emailEl.textContent = 'غير مسجل';
    if (statusEl) statusEl.innerHTML = '<i class="fa-regular fa-user" style="color:#aaa;"></i> غير مسجل';
    if (guestSection) guestSection.style.display = 'block';
    if (logoutSection) logoutSection.style.display = 'none';
    if (headerAvatarEl) headerAvatarEl.style.display = 'none';
    if (profileAvatarEl) profileAvatarEl.src = 'https://ui-avatars.com/api/?name=Guest&background=282828&color=aaa&size=200';
  }
}

// ─── AVATAR UPLOAD ────────────────────────────────────────────
window.openAvatarUpload = function() {
  if (!currentUser) { openAuthModal(); return; }
  document.getElementById('avatar-file-input')?.click();
};

window.handleAvatarUpload = async function(event) {
  const file = event.target.files[0];
  if (!file || !currentUser) return;

  // Show loading on avatar
  const profileAvatarEl = document.getElementById('profile-avatar-img');
  if (profileAvatarEl) profileAvatarEl.style.opacity = '0.4';

  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${currentUser.id}.${fileExt}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, file, { upsert: true });
    if (uploadError) throw uploadError;

    // Get public URL
    const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
    const publicUrl = data.publicUrl + '?t=' + Date.now();

    // Update user metadata
    await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });

    // Update UI immediately
    if (profileAvatarEl) { profileAvatarEl.src = publicUrl; profileAvatarEl.style.opacity = '1'; }
    const headerAvatarEl = document.getElementById('header-avatar');
    if (headerAvatarEl) headerAvatarEl.src = publicUrl;
  } catch (err) {
    console.error('Avatar upload error:', err);
    if (profileAvatarEl) profileAvatarEl.style.opacity = '1';
    alert('لم نتمكن من رفع الصورة. تأكد من إعداد Supabase Storage.');
  }
  // Reset input
  event.target.value = '';
};


window.openAuthModal = function() {
  const modal = document.getElementById('auth-modal');
  const sheet = document.getElementById('auth-sheet');
  if (!modal) return;
  isAuthMode = 'login';
  resetAuthForm();
  modal.style.display = 'flex';
  requestAnimationFrame(() => {
    sheet.style.transform = 'translateY(0)';
  });
};

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  const sheet = document.getElementById('auth-sheet');
  if (!modal) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => { modal.style.display = 'none'; }, 400);
}

window.skipAuth = function() {
  localStorage.setItem('sawt_auth_skipped', '1');
  closeAuthModal();
};

window.toggleAuthMode = function() {
  isAuthMode = isAuthMode === 'login' ? 'signup' : 'login';
  const nameField = document.getElementById('auth-name-field');
  const btnText = document.getElementById('auth-btn-text');
  const toggleText = document.getElementById('auth-toggle-text');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  const title = document.getElementById('auth-title');
  if (isAuthMode === 'signup') {
    if (nameField) nameField.style.display = 'block';
    if (btnText) btnText.textContent = 'إنشاء الحساب';
    if (toggleText) toggleText.textContent = 'لديك حساب؟';
    if (toggleBtn) toggleBtn.textContent = 'دخول';
    if (title) title.textContent = 'إنشاء حساب جديد';
  } else {
    if (nameField) nameField.style.display = 'none';
    if (btnText) btnText.textContent = 'دخول';
    if (toggleText) toggleText.textContent = 'ليس لديك حساب؟';
    if (toggleBtn) toggleBtn.textContent = 'إنشاء حساب';
    if (title) title.textContent = 'أهلاً بك في صوت الأحزان';
  }
  document.getElementById('auth-message').style.display = 'none';
};

function resetAuthForm() {
  const f = (id) => document.getElementById(id);
  if (f('auth-email')) f('auth-email').value = '';
  if (f('auth-password')) f('auth-password').value = '';
  if (f('auth-name')) f('auth-name').value = '';
  if (f('auth-message')) f('auth-message').style.display = 'none';
  if (f('auth-name-field')) f('auth-name-field').style.display = 'none';
  if (f('auth-btn-text')) f('auth-btn-text').textContent = 'دخول';
  if (f('auth-toggle-text')) f('auth-toggle-text').textContent = 'ليس لديك حساب؟';
  if (f('auth-toggle-btn')) f('auth-toggle-btn').textContent = 'إنشاء حساب';
  if (f('auth-title')) f('auth-title').textContent = 'أهلاً بك في صوت الأحزان';
  isAuthMode = 'login';
}

function showAuthMessage(msg, isError = true) {
  const el = document.getElementById('auth-message');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.background = isError ? 'rgba(255,69,58,0.15)' : 'rgba(76,175,80,0.15)';
  el.style.color = isError ? '#FF453A' : '#4CAF50';
  el.style.border = `1px solid ${isError ? 'rgba(255,69,58,0.3)' : 'rgba(76,175,80,0.3)'}`;
}

function setAuthLoading(loading) {
  const btn = document.getElementById('auth-submit-btn');
  const spinner = document.getElementById('auth-btn-spinner');
  if (btn) btn.disabled = loading;
  if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
}

window.signInWithGoogle = async function() {
  document.getElementById('auth-message').style.display = 'none';
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.href
      }
    });
    if (error) throw error;
  } catch (err) {
    showAuthMessage('فشل تسجيل الدخول بواسطة جوجل', true);
    console.error(err);
  }
}

window.submitAuth = async function() {
  const email = document.getElementById('auth-email')?.value?.trim();
  const password = document.getElementById('auth-password')?.value;
  const name = document.getElementById('auth-name')?.value?.trim();

  if (!email || !password) { showAuthMessage('يرجى تعبئة جميع الحقول'); return; }
  if (password.length < 6) { showAuthMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }

  setAuthLoading(true);
  document.getElementById('auth-message').style.display = 'none';

  try {
    if (isAuthMode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name || email.split('@')[0] } }
      });
      if (error) throw error;
      if (data.session) {
        closeAuthModal();
      } else {
        showAuthMessage('تم إنشاء الحساب بنجاح! إذا كانت رسالة التفعيل مطلوبة يرجى تفقد بريدك.', false);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      closeAuthModal();
    }
  } catch (err) {
    let msg = 'حدث خطأ، يرجى المحاولة مجدداً';
    if (err.message.includes('Invalid login')) msg = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
    if (err.message.includes('already registered')) msg = 'هذا البريد الإلكتروني مسجل مسبقاً';
    if (err.message.includes('Email not confirmed')) msg = 'يرجى تأكيد البريد الإلكتروني أولاً';
    showAuthMessage(msg);
  }
  setAuthLoading(false);
};

window.doLogout = async function() {
  await supabase.auth.signOut();
  currentUser = null;
  updateProfileUI();
};

window.toggleAuthPasswordVisibility = function() {
  const input = document.getElementById('auth-password');
  const icon = document.getElementById('auth-eye-icon');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) { icon.className = 'fa-regular fa-eye-slash'; }
  } else {
    input.type = 'password';
    if (icon) { icon.className = 'fa-regular fa-eye'; }
  }
};

// ─── SUPABASE LIKES SYNC ──────────────────────────────────────
async function syncLikesFromSupabase() {
  if (!currentUser) return;
  try {
    const { data, error } = await supabase
      .from('user_likes')
      .select('poem_id')
      .eq('user_id', currentUser.id);
    if (error) throw error;
    const ids = (data || []).map(r => r.poem_id);
    LibraryStore.likes = ids;
  } catch (e) {
    console.warn('Could not sync likes:', e);
  }
}

async function pushLikeToSupabase(poemId, liked) {
  if (!currentUser) return;
  try {
    if (liked) {
      await supabase.from('user_likes').upsert({ user_id: currentUser.id, poem_id: poemId }, { onConflict: 'user_id,poem_id' });
    } else {
      await supabase.from('user_likes').delete().eq('user_id', currentUser.id).eq('poem_id', poemId);
    }
  } catch (e) {
    console.warn('Could not push like:', e);
  }
}

// ─── SUPABASE PLAYLISTS SYNC ───────────────────────────────────
async function syncPlaylistsFromSupabase() {
  if (!currentUser) return;
  try {
    const { data, error } = await supabase
      .from('user_playlists')
      .select('id, title, tracks')
      .eq('user_id', currentUser.id);
    if (error) throw error;
    
    // Map data to local structure: { id, name, tracks }
    const mapped = (data || []).map(r => ({
      id: r.id,
      name: r.title,
      tracks: r.tracks || []
    }));
    _memoryPlaylists = mapped;
  } catch (e) {
    console.warn('Could not sync playlists:', e);
  }
}

async function createPlaylistInSupabase(name) {
  if (!currentUser) return null;
  try {
    const newId = 'playlist_' + Date.now();
    const { data, error } = await supabase
      .from('user_playlists')
      .insert({ id: newId, user_id: currentUser.id, title: name, tracks: [] })
      .select('id, title, tracks')
      .single();
    if (error) throw error;
    return { id: data.id, name: data.title, tracks: data.tracks || [] };
  } catch (e) {
    console.warn('Could not create playlist:', e);
    return null;
  }
}

async function updatePlaylistTracksInSupabase(playlistId, tracks) {
  if (!currentUser) return;
  try {
    const { error } = await supabase
      .from('user_playlists')
      .update({ tracks: tracks })
      .eq('id', playlistId)
      .eq('user_id', currentUser.id);
    if (error) throw error;
  } catch (e) {
    console.warn('Could not update playlist tracks:', e);
  }
}

let isPlaying = false;
let currentPoem = null;
let globalPoems = [];
let globalReciters = [];

// LocalStorage wrapper for Library features
let _memoryPlaylists = [];

const LibraryStore = {
  get likes() { return JSON.parse(localStorage.getItem('sawt_likes')) || []; },
  set likes(arr) { localStorage.setItem('sawt_likes', JSON.stringify(arr)); },
  
  get downloads() { return JSON.parse(localStorage.getItem('sawt_downloads')) || []; },
  set downloads(arr) { localStorage.setItem('sawt_downloads', JSON.stringify(arr)); },
  
  get playlists() { 
    return currentUser ? _memoryPlaylists : (JSON.parse(localStorage.getItem('sawt_playlists')) || []); 
  },
  set playlists(arr) { 
    if (currentUser) { _memoryPlaylists = arr; } 
    else { localStorage.setItem('sawt_playlists', JSON.stringify(arr)); }
  },
  
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

  async addPlaylist(name) {
    if (currentUser) {
      const newPl = await createPlaylistInSupabase(name);
      if (newPl) {
        _memoryPlaylists.push(newPl);
      }
    } else {
      let arr = this.playlists;
      arr.push({ id: Date.now().toString(), name, tracks: [] });
      this.playlists = arr;
    }
  },

  async addTrackToPlaylist(playlistId, trackId) {
    let arr = this.playlists;
    let pl = arr.find(p => p.id === playlistId);
    if (pl) {
      if (!pl.tracks.includes(trackId)) {
        pl.tracks.push(trackId);
        this.playlists = arr;
        if (currentUser) {
          updatePlaylistTracksInSupabase(playlistId, pl.tracks);
        }
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
    
    // Check for Deep Link (Shared Track)
    const urlParams = new URLSearchParams(window.location.search);
    const sharedTrackId = urlParams.get('track');
    if (sharedTrackId) {
      const sharedTrack = globalPoems.find(p => p.id === sharedTrackId);
      if (sharedTrack) {
        setTimeout(() => {
          openTrackDetail(sharedTrack);
        }, 300); // slight delay to ensure DOM is ready
      }
    }
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

window.toggleLike = function() {
  isLiked = !isLiked;
  const btn = document.getElementById('fp-like-btn');
  if (btn) {
    btn.className = isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    btn.style.color = isLiked ? 'var(--accent)' : 'white';
  }
  // Also persist the like if a poem is playing
  if (currentPoem) {
    LibraryStore.toggleLike(currentPoem.id);
    pushLikeToSupabase(currentPoem.id, isLiked);
  }
}

window.toggleAutoplay = function() {
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
    // Update similar list only on fresh play to show tracks by the same reciter
    let reciterTracks = [...globalPoems].filter(p => p.reciterName === poem.reciterName && p.audioUrl !== poem.audioUrl).sort(() => 0.5 - Math.random());
    // If not enough tracks by this reciter, pad with other random tracks
    if (reciterTracks.length < 5) {
      const otherTracks = [...globalPoems].filter(p => p.reciterName !== poem.reciterName && p.audioUrl !== poem.audioUrl).sort(() => 0.5 - Math.random());
      reciterTracks = [...reciterTracks, ...otherTracks];
    }
    similarList = reciterTracks.slice(0, 5);
  }
  
  // Update Mini Player only if full player is not open
  const player = document.getElementById('mini-player');
  const fullPlayer = document.getElementById('full-player-view');
  if (!fullPlayer || !fullPlayer.classList.contains('open')) {
    player.style.display = 'flex';
    player.classList.add('active');
  }

  document.getElementById('mp-cover').src = poem.coverImage;
  const el_mp_title = document.getElementById('mp-title'); if (el_mp_title) el_mp_title.textContent = poem.title;
  const el_mp_reciter = document.getElementById('mp-reciter'); if (el_mp_reciter) el_mp_reciter.textContent = poem.reciterName;
  
  // Update Full Player
  document.getElementById('fp-cover').src = poem.coverImage;
  const el_fp_title = document.getElementById('fp-title'); if (el_fp_title) el_fp_title.textContent = poem.title;
  const el_fp_artist = document.getElementById('fp-artist'); if (el_fp_artist) el_fp_artist.textContent = poem.reciterName;
  
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
      pushLikeToSupabase(poem.id, liked);
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
      card.onclick = () => playPoem(t);
      similarContainer.appendChild(card);
    });
  }

  if (queueContainer) {
    updateQueueUI();
  }

  // Update Lyrics
  const lyricsText = poem.lyrics || 'الكلمات غير متوفرة';
  const lyricsPreview = document.getElementById('fp-lyrics-preview');
  if (lyricsPreview) lyricsPreview.textContent = lyricsText;
  const lyricsContent = document.getElementById('lyrics-content');
  if (lyricsContent) lyricsContent.textContent = lyricsText;
  const lyTitle = document.getElementById('ly-title');
  if (lyTitle) lyTitle.textContent = poem.title;
  const lyArtist = document.getElementById('ly-artist');
  if (lyArtist) lyArtist.textContent = poem.reciterName;

  loadAndPlay(poem.audioUrl);
}

// Removed old openTrackDetail

// ─── Lyrics View ─────────────────────────────────────────────
window.openLyricsView = function() {
  const view = document.getElementById('lyrics-view');
  if (!view) return;
  history.pushState({ overlay: 'lyrics' }, '');
  view.style.display = 'block';
  requestAnimationFrame(() => {
    view.style.transform = 'translateY(0)';
  });
};

window.closeLyricsView = function() {
  const view = document.getElementById('lyrics-view');
  if (!view) return;
  view.style.transform = 'translateY(100%)';
  setTimeout(() => { view.style.display = 'none'; }, 350);
  history.back();
};

window.openCurrentTrackOptions = function(event) {
  if (currentPoem) {
    openTrackOptions(event, currentPoem.id);
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
  const el_track_options_title = document.getElementById('track-options-title'); if (el_track_options_title) el_track_options_title.textContent = poem.title || poem.name || 'مجهول';
  const el_track_options_artist = document.getElementById('track-options-artist'); if (el_track_options_artist) el_track_options_artist.textContent = poem.reciterName || 'مجهول';
  
  // Like Button
  const isLiked = LibraryStore.likes.includes(poem.id);
  const likeIcon = document.getElementById('opt-like-icon');
  likeIcon.className = isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
  likeIcon.style.color = isLiked ? '#E91E63' : 'white';
  document.getElementById('opt-like').onclick = (e) => {
    e.stopPropagation();
    const liked = LibraryStore.toggleLike(poem.id);
    pushLikeToSupabase(poem.id, liked);
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
    
    // Generate deep link
    const shareUrl = window.location.origin + window.location.pathname + '?track=' + poem.id;
    
    if (navigator.share) {
      navigator.share({
        title: poem.title,
        text: 'استمع إلى ' + poem.title + ' بصوت ' + poem.reciterName,
        url: shareUrl
      }).catch(err => console.log('Share canceled', err));
    } else {
      // Fallback for browsers without navigator.share
      navigator.clipboard.writeText(shareUrl).then(() => {
        alert('تم نسخ الرابط!');
      }).catch(err => {
        alert('لم نتمكن من نسخ الرابط: ' + shareUrl);
      });
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
let animationFrameId = null;
let lastKnownTime = 0;
let lastKnownRealTime = performance.now();

function updateProgressUI() {
  if (audioContext.duration && isFinite(audioContext.duration)) {
    let visualTime = audioContext.currentTime;
    
    if (visualTime > audioContext.duration) visualTime = audioContext.duration;
    
    const progress = (visualTime / audioContext.duration) * 100;
    
    // Update Full Player Slider
    const fpProgress = document.getElementById('fp-progress');
    if (!isDraggingProgress && fpProgress) {
      fpProgress.value = progress;
      fpProgress.style.background = `linear-gradient(to left, var(--accent) ${progress}%, rgba(255,255,255,0.2) ${progress}%)`;
      const el_fp_current_time = document.getElementById('fp-current-time'); 
      if (el_fp_current_time) el_fp_current_time.textContent = formatTime(visualTime);
    }
    const el_fp_total_time = document.getElementById('fp-total-time'); 
    if (el_fp_total_time) el_fp_total_time.textContent = formatTime(audioContext.duration);
    
    // Update Mini Player Circular Progress
    const mpRing = document.getElementById('mp-progress-ring');
    if (mpRing) {
      mpRing.style.background = `conic-gradient(#d3a84c ${progress}%, rgba(255,255,255,0.1) 0%)`;
    }
  }
}

function startProgressLoop() {
  updateProgressUI();
  if (!audioContext.paused) {
    animationFrameId = requestAnimationFrame(startProgressLoop);
  }
}

audioContext.addEventListener('play', () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  startProgressLoop();
});

audioContext.addEventListener('pause', () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
});

audioContext.addEventListener('timeupdate', () => {
  if (audioContext.paused) {
    updateProgressUI();
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

  const tdBtn = document.getElementById('td-play-btn');
  if (tdBtn) tdBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play" style="margin-left: 4px;"></i>';
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
  fpProgressElement.addEventListener('input', (e) => {
    isDraggingProgress = true;
    const progress = e.target.value;
    e.target.style.background = `linear-gradient(to left, var(--accent) ${progress}%, rgba(255,255,255,0.2) ${progress}%)`;
    if (audioContext.duration && isFinite(audioContext.duration)) {
      const seekTime = (progress / 100) * audioContext.duration;
      const el_fp_current_time = document.getElementById('fp-current-time'); 
      if (el_fp_current_time) el_fp_current_time.textContent = formatTime(seekTime);
    }
  });
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

window.submitCreatePlaylist = async function() {
  const input = document.getElementById('new-playlist-name');
  const name = input.value.trim();
  if (name) {
    await LibraryStore.addPlaylist(name);
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
  
  const el_playlist_title = document.getElementById('playlist-title'); if (el_playlist_title) el_playlist_title.textContent = title;
  const el_playlist_subtitle = document.getElementById('playlist-subtitle'); if (el_playlist_subtitle) el_playlist_subtitle.textContent = subtitle;
  
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
        el.onclick = () => playPoem(track);
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
      el.onclick = () => playPoem(track);
      tc.appendChild(el);
    });
    
    const playAllBtn = document.getElementById('category-play-all');
    if (playAllBtn) {
      playAllBtn.onclick = () => {
        if (filtered.length > 0) {
          queueList = [...filtered];
          queueIndex = 0;
          playPoem(filtered[0], true);
          
          // Update similarList manually
          let reciterTracks = [...globalPoems].filter(p => p.reciterName === filtered[0].reciterName && p.audioUrl !== filtered[0].audioUrl).sort(() => 0.5 - Math.random());
          if (reciterTracks.length < 5) {
            const otherTracks = [...globalPoems].filter(p => p.reciterName !== filtered[0].reciterName && p.audioUrl !== filtered[0].audioUrl).sort(() => 0.5 - Math.random());
            reciterTracks = [...reciterTracks, ...otherTracks];
          }
          similarList = reciterTracks.slice(0, 5);
        }
      };
    }
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
  
  const el_artist_detail_name = document.getElementById('artist-detail-name'); if (el_artist_detail_name) el_artist_detail_name.textContent = artistName;
  const el_artist_detail_stats = document.getElementById('artist-detail-stats'); if (el_artist_detail_stats) el_artist_detail_stats.textContent = artistTracks.length + ' مقطع مسموع';
  
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
initAuth();
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
  }
  
  const lyricsView = document.getElementById('lyrics-view');
  if (lyricsView && lyricsView.style.display === 'block') {
    lyricsView.style.transform = 'translateY(100%)';
    setTimeout(() => { lyricsView.style.display = 'none'; }, 350);
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

window.openTrackDetail = function(poemOrId) {
  let poem = poemOrId;
  if (typeof poemOrId === 'string' || typeof poemOrId === 'number') {
    poem = globalPoems.find(p => String(p.id) === String(poemOrId));
  }
  if (!poem) return;
  history.pushState({ overlay: 'track-detail' }, '');
  const tdView = document.getElementById('track-detail-view');
  if (tdView) tdView.style.display = 'block';
  
  const tdCover = document.getElementById('td-cover');
  tdCover.src = poem.coverImage || poem.image;
  
  // Set blurred background blob color dynamically based on cover? Or just leave it #337183 for now as per design.
  
  const el_td_title = document.getElementById('td-title'); if (el_td_title) el_td_title.textContent = poem.title;
  const artistEl = document.getElementById('td-artist');
  artistEl.textContent = poem.reciterName || 'مجهول';
  artistEl.onclick = () => openArtistDetail(poem.reciterName);
  
  const artistImg = document.getElementById('td-artist-img');
  if (artistImg) {
    const artist = globalReciters.find(a => a.name === poem.reciterName);
    artistImg.src = artist && artist.image ? artist.image : 'https://i.pravatar.cc/150?img=11';
    artistImg.onclick = () => openArtistDetail(poem.reciterName);
  }
  
  const playBtn = document.getElementById('td-play-btn');
  playBtn.onclick = () => {
    if (currentPoem && currentPoem.id === poem.id) {
      togglePlay();
    } else {
      playPoem(poem);
    }
  };
  
  // Initialize icon state
  playBtn.innerHTML = (currentPoem && currentPoem.id === poem.id && isPlaying) 
    ? '<i class="fa-solid fa-pause"></i>' 
    : '<i class="fa-solid fa-play" style="margin-left: 4px;"></i>';
  
  const likeBtn = document.getElementById('td-like-btn');
  const updateLikeBtn = () => {
    const isLiked = LibraryStore.likes.includes(poem.id);
    likeBtn.className = isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    likeBtn.style.color = isLiked ? '#57B560' : 'white';
  };
  updateLikeBtn();
  likeBtn.onclick = () => {
    LibraryStore.toggleLike(poem.id);
    updateLikeBtn();
  };
  
  const dlBtn = document.getElementById('td-download-btn');
  const updateDlBtn = () => {
    const isDl = LibraryStore.downloads.includes(poem.id);
    dlBtn.style.color = isDl ? '#57B560' : 'white';
  };
  updateDlBtn();
  dlBtn.onclick = async () => {
    dlBtn.className = 'fa-solid fa-spinner fa-spin';
    await LibraryStore.toggleDownload(poem.id);
    dlBtn.className = 'fa-solid fa-arrow-down';
    updateDlBtn();
  };
  
  const optionsBtn = document.getElementById('td-options-btn');
  optionsBtn.onclick = (e) => openTrackOptions(e, poem.id);
  
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

  // Trending Works
  const trendingContainer = document.getElementById('td-trending-list');
  const trendingTitle = document.getElementById('td-trending-title');
  if (trendingContainer && trendingTitle) {
    trendingContainer.innerHTML = '';
      const trending = [...globalPoems]
        .filter(p => p.reciterName === poem.reciterName && p.id !== poem.id)
        .sort(() => 0.5 - Math.random())
        .slice(0, 10);
        
      if (trending.length > 0) {
        trendingTitle.textContent = `الأعمال الرائجة لـ ${poem.reciterName || 'الرادود'}`;
        trending.forEach(track => {
          const el = document.createElement('div');
          el.className = 'album-card reciter-card';
          el.style.width = '32vw';
          el.style.maxWidth = '140px';
          el.style.flexShrink = '0';
          
          el.innerHTML = `
            <img src="${track.coverImage || track.image}" style="width: 100%; aspect-ratio: 1; border-radius: 8px; object-fit: cover;" />
            <div style="font-size: 14px; font-weight: bold; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right;">${track.title || track.name}</div>
          `;
        el.onclick = () => playPoem(track);
        trendingContainer.appendChild(el);
      });
      trendingTitle.parentElement.style.display = 'block';
    } else {
      trendingTitle.parentElement.style.display = 'none';
    }
  }

  // Fans Also Like
  const fansContainer = document.getElementById('td-fans-like-list');
  if (fansContainer) {
    fansContainer.innerHTML = '';
    const otherReciters = [...globalReciters]
      .filter(r => r.name !== poem.reciterName)
      .sort(() => 0.5 - Math.random())
      .slice(0, 6);
      
    if (otherReciters.length > 0) {
      otherReciters.forEach(r => {
        const card = document.createElement('div');
        card.className = 'square-card animate-in';
        card.style.flexShrink = '0';
        card.innerHTML = `
          <img src="${r.image}" alt="${r.name}" class="square-cover" style="border-radius: 50%;" />
          <div class="square-title" style="text-align: center; font-size: 14px; margin-top: 8px; color: white;">${r.name}</div>
        `;
        card.onclick = () => openArtistDetail(r.name);
        fansContainer.appendChild(card);
      });
      fansContainer.parentElement.style.display = 'block';
    } else {
      fansContainer.parentElement.style.display = 'none';
    }
  }
};
