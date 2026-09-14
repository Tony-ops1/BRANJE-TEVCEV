(() => {
  function setupGallery() {
    const photo = document.getElementById('photo');
    if (!photo || document.getElementById('galleryBtn')) return;

    const gallery = document.createElement('input');
    gallery.type = 'file';
    gallery.accept = 'image/*';
    gallery.id = 'galleryPhoto';
    gallery.style.display = 'none';
    photo.insertAdjacentElement('afterend', gallery);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'galleryBtn';
    btn.className = 'secondary';
    btn.textContent = '🖼️ Izberi iz galerije';

    const card = photo.closest('.card');
    const row = card ? card.querySelector('.btnrow') : null;
    if (row) row.appendChild(btn);
    else photo.insertAdjacentElement('afterend', btn);

    btn.addEventListener('click', () => {
      gallery.value = '';
      gallery.click();
    });

    gallery.addEventListener('change', () => {
      const file = gallery.files && gallery.files[0];
      if (!file) return;

      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        photo.files = dt.files;
        photo.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (err) {
        console.error(err);
        const status = document.getElementById('ocrStatus');
        if (status) status.textContent = 'Izbira iz galerije v tem brskalniku ni uspela. Poskusi odpreti aplikacijo v Safari/Chrome.';
        alert('Galerije ni bilo mogoče predati OCR-ju. Odpri aplikacijo v Safari ali Chrome in poskusi znova.');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupGallery, { once: true });
  } else {
    setupGallery();
  }
})();
