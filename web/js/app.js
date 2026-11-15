/**
 * Pakshee — Main Application Coordinator
 * Glues together spatial visualization, acoustic engine, and scroll-driven narrative.
 */

window.pakshee = window.pakshee || {};

(function () {
  'use strict';

  let currentStation = null;

  function dismissModal() {
    const modal = document.getElementById('audio-modal');
    if (modal) {
      modal.classList.add('dismissed');
      setTimeout(() => {
        modal.style.display = 'none';
      }, 500);
    }
  }

  function initApp() {
    console.log('[Pakshee] Initializing application components...');

    // 1. Wire UI & Modal Controls FIRST (ensures modal dismiss works immediately)
    setupAudioModal();
    setupHeaderControls();
    setupStationCard();
    setupScrollNarrative();

    // 2. Initialize Map
    try {
      if (window.pakshee.map && window.pakshee.map.init) {
        window.pakshee.map.init(handleStationSelected, handleDistrictSelected);
      }
    } catch (err) {
      console.error('[Pakshee Map] Initialization error:', err);
    }
  }

  /**
   * Audio Modal Activation
   */
  function setupAudioModal() {
    const startBtn = document.getElementById('enable-audio-btn');

    if (startBtn) {
      startBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        dismissModal(); // Always dismiss modal so user can view and use the map!

        try {
          if (window.pakshee.audio && window.pakshee.audio.init) {
            await window.pakshee.audio.init();
            window.pakshee.audio.playStation({ pm25: 25.0 });
          }
        } catch (err) {
          console.warn('[Pakshee Audio] Audio activation error:', err);
        }
      });
    }
  }

  /**
   * Top Header Controls (Mute & Bias Layer Toggles)
   */
  function setupHeaderControls() {
    const biasBtn = document.getElementById('toggle-bias-btn');
    const audioBtn = document.getElementById('audio-toggle-btn');
    const audioLabel = document.getElementById('audio-status-label');

    if (biasBtn) {
      biasBtn.addEventListener('click', () => {
        if (window.pakshee.map) {
          const isVisible = window.pakshee.map.toggleBiasLayer();
          biasBtn.classList.toggle('active', isVisible);
        }
      });
    }

    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        if (window.pakshee.audio) {
          const active = window.pakshee.audio.toggleMute();
          audioBtn.classList.toggle('active', active);
          if (audioLabel) audioLabel.textContent = active ? 'Audio Active' : 'Audio Muted';
        }
      });
    }
  }

  /**
   * Station Detail Card Interaction
   */
  function setupStationCard() {
    const card = document.getElementById('station-card');
    const closeBtn = document.getElementById('card-close');
    const playBtn = document.getElementById('card-play-btn');

    if (closeBtn && card) {
      closeBtn.addEventListener('click', () => {
        card.classList.add('hidden');
      });
    }

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (currentStation && window.pakshee.audio) {
          window.pakshee.audio.playStation(currentStation);
        }
      });
    }
  }

  /**
   * Handler when an AQ station is selected (clicked or scrolled to)
   */
  function handleStationSelected(props, coords) {
    currentStation = props;

    // 1. Fly to Station
    if (coords && window.pakshee.map) {
      window.pakshee.map.flyTo(coords, 10.5);
    }

    // 2. Trigger Acoustic Sonification
    if (window.pakshee.audio) {
      window.pakshee.audio.playStation(props).then(acousticParams => {
        updateCardUI(props, acousticParams);
      });
    }
  }

  /**
   * Handler when a district / silent zone is selected
   */
  function handleDistrictSelected(props) {
    const isSilent = props.is_silent;
    const name = props.district || 'Unmonitored Region';
    const state = props.state || 'India';
    const biasCat = props.bias_category || 'Silent Zone';

    if (window.pakshee.audio) {
      window.pakshee.audio.playSilentZone(name);
    }

    // Show card explaining the silent zone
    const card = document.getElementById('station-card');
    if (!card) return;

    const cityEl = document.getElementById('card-city');
    if (cityEl) cityEl.textContent = state.toUpperCase();

    const nameEl = document.getElementById('card-name');
    if (nameEl) nameEl.textContent = `${name} (District)`;

    const pmEl = document.getElementById('card-pm25');
    if (pmEl) pmEl.textContent = '—';
    
    const aqiBadge = document.getElementById('card-aqi');
    if (aqiBadge) {
      aqiBadge.textContent = biasCat;
      aqiBadge.style.background = isSilent ? '#e74c3c' : '#34495e';
    }

    const harmEl = document.getElementById('card-harmony');
    if (harmEl) harmEl.textContent = 'Silence / Void';

    const meterEl = document.getElementById('card-meter');
    if (meterEl) meterEl.style.width = '5%';

    const descEl = document.getElementById('card-timbre-desc');
    if (descEl) {
      descEl.textContent = isSilent 
        ? `Zero continuous ambient monitoring stations detected for this district. Estimated population density: ${props.density_est || 350}/km². The air remains silent in official data.`
        : `Monitored with ${props.station_count} active stations.`;
    }

    const timeEl = document.getElementById('card-time');
    if (timeEl) timeEl.textContent = 'Monitoring Bias Layer • Census 2011';

    card.classList.remove('hidden');
  }

  /**
   * Update the station card panel with real-time readings and sonic descriptions
   */
  function updateCardUI(props, acousticParams) {
    const card = document.getElementById('station-card');
    if (!card) return;

    const cityEl = document.getElementById('card-city');
    if (cityEl) cityEl.textContent = (props.city || 'INDIA').toUpperCase();

    const nameEl = document.getElementById('card-name');
    if (nameEl) nameEl.textContent = props.name || 'Monitoring Station';

    const pmEl = document.getElementById('card-pm25');
    if (pmEl) pmEl.textContent = props.pm25 !== null ? props.pm25 : 'N/A';

    const aqiBadge = document.getElementById('card-aqi');
    if (aqiBadge) {
      aqiBadge.textContent = props.aqiCategory || 'Unknown';
      aqiBadge.style.background = props.aqiColor || '#7f8c8d';
    }

    if (acousticParams) {
      const harmEl = document.getElementById('card-harmony');
      if (harmEl) {
        harmEl.textContent = 
          props.pm25 <= 30 ? 'Consonant Harmony' :
          props.pm25 <= 90 ? 'Tension & Detuning' :
          props.pm25 <= 250 ? 'Abrasive Dissonance' : 'Bitcrushed Decay';
      }

      const meterPct = Math.min(100, Math.max(8, (props.pm25 / 300) * 100));
      const meterEl = document.getElementById('card-meter');
      if (meterEl) meterEl.style.width = `${meterPct}%`;

      const descEl = document.getElementById('card-timbre-desc');
      if (descEl) descEl.textContent = acousticParams.textureDesc;
    }

    const timeStr = props.lastUpdated ? new Date(props.lastUpdated).toLocaleTimeString() : 'Live';
    const timeEl = document.getElementById('card-time');
    if (timeEl) timeEl.textContent = `Updated ${timeStr} • OpenAQ v3`;

    card.classList.remove('hidden');
  }

  /**
   * Scroll-Driven Narrative Observer
   */
  function setupScrollNarrative() {
    const chapters = document.querySelectorAll('.story-chapter');
    if (!chapters.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          chapters.forEach(c => c.classList.remove('active'));
          entry.target.classList.add('active');

          const centerStr = entry.target.dataset.center;
          const zoomStr = entry.target.dataset.zoom;
          const isBias = entry.target.dataset.bias === 'true';

          if (centerStr && zoomStr && window.pakshee.map) {
            try {
              const center = JSON.parse(centerStr);
              const zoom = parseFloat(zoomStr);
              window.pakshee.map.flyTo(center, zoom);
            } catch (e) {}
          }

          if (isBias && window.pakshee.map) {
            window.pakshee.map.toggleBiasLayer(true);
            const biasBtn = document.getElementById('toggle-bias-btn');
            if (biasBtn) biasBtn.classList.add('active');
          }
        }
      });
    }, {
      threshold: 0.5
    });

    chapters.forEach(c => observer.observe(c));
  }

  /**
   * Public helper to fly and sonify a major city
   */
  function playCity(cityName) {
    if (!window.pakshee.map) return;
    const match = window.pakshee.map.findStationByCity(cityName);
    if (match) {
      handleStationSelected(match.properties, match.geometry.coordinates);
    } else {
      console.warn(`No station found for ${cityName}`);
    }
  }

  function toggleBiasLayer(forceState) {
    if (!window.pakshee.map) return;
    const isVisible = window.pakshee.map.toggleBiasLayer(forceState);
    const biasBtn = document.getElementById('toggle-bias-btn');
    if (biasBtn) biasBtn.classList.toggle('active', isVisible);
  }

  // Safe DOM lifecycle loader
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

  window.pakshee.app = {
    dismissModal: dismissModal,
    playCity: playCity,
    toggleBiasLayer: toggleBiasLayer,
    selectStation: handleStationSelected
  };

})();
