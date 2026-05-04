export function renderPayroll(el) {
  el.innerHTML = `
    <h3>ანაზღაურების ავტომატური გამოთვლა</h3>
    <input id="doneOrders" type="number" placeholder="შესრულებული შეკვეთები" />
    <input id="pricePerOrder" type="number" placeholder="თანხა ერთ შეკვეთაზე" />
    <button id="calcPayrollBtn" class="small-btn">დათვლა</button>
    <p id="payrollResult">შედეგი: 0₾</p>
  `;
  document.getElementById("calcPayrollBtn").addEventListener("click", () => {
    const count = Number(document.getElementById("doneOrders").value || 0);
    const price = Number(document.getElementById("pricePerOrder").value || 0);
    document.getElementById("payrollResult").textContent = `შედეგი: ${count * price}₾`;
  });
}
