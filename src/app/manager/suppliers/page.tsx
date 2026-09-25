// Same screen as Admin → Suppliers, with the same powers: /api/suppliers and
// /api/suppliers/[id] both allow MANAGER, and the credit figures the page
// shows are scoped to the manager's own warehouse server-side. Re-exported
// rather than copied so the two can't drift apart.
export { default } from "@/app/admin/suppliers/page";
