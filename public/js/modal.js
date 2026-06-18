const Modal = {
  show(html, large = false) {
    const box = document.getElementById('genericModalBox');
    box.className = 'modal' + (large ? ' modal-lg' : '');
    document.getElementById('genericModalContent').innerHTML = html;
    document.getElementById('genericModal').classList.remove('hidden');
  },
  close() {
    document.getElementById('genericModal').classList.add('hidden');
    document.getElementById('genericModalContent').innerHTML = '';
  },
  confirm(message, onConfirm) {
    Modal.show(`
      <h3 style="margin-bottom:1rem">Confirmation</h3>
      <p style="margin-bottom:1.5rem;color:var(--text-muted)">${message}</p>
      <div class="form-actions">
        <button class="btn btn-outline" onclick="Modal.close()">Annuler</button>
        <button class="btn btn-danger" id="confirmBtn">Confirmer</button>
      </div>
    `);
    document.getElementById('confirmBtn').onclick = () => { Modal.close(); onConfirm(); };
  }
};

document.getElementById('genericModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('genericModal')) Modal.close();
});
