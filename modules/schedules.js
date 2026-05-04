export function renderSchedules(el) {
  el.innerHTML = `
    <h3>დაგეგმვის ავტომატიზაცია</h3>
    <input type="date" />
    <input type="time" />
    <input placeholder="კურიერი / პერსონალი" />
    <textarea placeholder="დავალება"></textarea>
    <button class="small-btn">დაგეგმვა</button>
    <p>Firestore collection: <b>schedules</b></p>
  `;
}
