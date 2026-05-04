export function renderAnalytics(el) {
  el.innerHTML = `
    <h3>ანალიტიკა და ეფექტიანობის ანალიზი</h3>
    <div class="stat-grid">
      <div class="stat"><b>0</b><span>დღის შეკვეთები</span></div>
      <div class="stat"><b>0₾</b><span>შემოსავალი</span></div>
      <div class="stat"><b>0</b><span>აქტიური კურიერი</span></div>
      <div class="stat"><b>0%</b><span>შესრულება</span></div>
    </div>
    <p>შემდეგ ეტაპზე აქ ჩავამატებთ რეალურ Firestore aggregation-ს და გრაფიკებს.</p>
  `;
}
