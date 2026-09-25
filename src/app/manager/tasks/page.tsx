"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonTable } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";

type TaskItem = {
  id: string;
  taskNo: string;
  title: string;
  description: string;
  department: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "VERIFIED" | "CANCELLED";
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  assignedTo: { id: string; name: string; staffId: string; role: string } | null;
  createdBy: { id: string; name: string; staffId: string };
};

type TaskResponse = {
  tasks: TaskItem[];
  staffList: { id: string; name: string; staffId: string; role: string }[];
};

export default function ManagerTasksPage() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");

  const url = `/api/manager/tasks?${statusFilter ? `status=${statusFilter}&` : ""}${priorityFilter ? `priority=${priorityFilter}` : ""}`;
  const { data, error, loading, reload } = useApiGet<TaskResponse>(url);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [assignedToId, setAssignedToId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !description) return;
    setSaving(true);
    try {
      const res = await fetch("/api/manager/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          department: department || undefined,
          priority,
          assignedToId: assignedToId || undefined,
          dueDate: dueDate || undefined,
          notes: notes || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to create task");
      setShowCreateModal(false);
      setTitle("");
      setDescription("");
      setDepartment("");
      setAssignedToId("");
      setDueDate("");
      setNotes("");
      setActionMessage(`Task ${body.task.taskNo} created successfully`);
      reload();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateStatus(id: string, newStatus: string) {
    try {
      const res = await fetch(`/api/manager/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to update task");
      setActionMessage(`Task updated to ${newStatus}`);
      reload();
    } catch (err: any) {
      alert(err.message);
    }
  }

  if (loading) return <SkeletonTable rows={8} cols={6} />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Task Management & Delegation (MGR-08)</h1>
          <p className="text-xs text-muted">
            Assign, track, and verify operational warehouse tasks across Inventory, QC, Billing & Procurement teams.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreateModal(true)} className="btn-primary text-xs py-1.5 px-3">
            + Delegate New Task
          </button>
          <button onClick={reload} className="btn-secondary text-xs py-1.5 px-3">
            Refresh
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded text-sm font-medium">
          ✅ {actionMessage}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input text-xs py-1 px-2 border-border"
        >
          <option value="">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed (Awaiting Verification)</option>
          <option value="VERIFIED">Verified & Closed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="input text-xs py-1 px-2 border-border"
        >
          <option value="">All Priorities</option>
          <option value="URGENT">Urgent 🔴</option>
          <option value="HIGH">High 🟠</option>
          <option value="MEDIUM">Medium 🟡</option>
          <option value="LOW">Low ⚪</option>
        </select>
      </div>

      {/* Tasks Table */}
      <div className="card space-y-4">
        {data.tasks.length === 0 ? (
          <p className="text-sm text-muted py-8 text-center">No tasks match the selected filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="py-2">Task No</th>
                  <th>Priority</th>
                  <th>Title & Description</th>
                  <th>Department</th>
                  <th>Assignee</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((task) => (
                  <tr key={task.id} className="border-b border-border/50 hover:bg-muted/10">
                    <td className="py-3 font-mono text-xs font-semibold">{task.taskNo}</td>
                    <td>
                      <span
                        className={`badge text-xs font-bold px-2 py-0.5 ${
                          task.priority === "URGENT"
                            ? "bg-rose-100 text-rose-800"
                            : task.priority === "HIGH"
                            ? "bg-orange-100 text-orange-800"
                            : task.priority === "MEDIUM"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-800"
                        }`}
                      >
                        {task.priority}
                      </span>
                    </td>
                    <td>
                      <div className="font-semibold">{task.title}</div>
                      <div className="text-xs text-muted max-w-sm truncate">{task.description}</div>
                    </td>
                    <td>
                      {task.department ? (
                        <span className="badge bg-blue-100 text-blue-800 text-xs">{task.department}</span>
                      ) : (
                        <span className="text-xs text-muted">General</span>
                      )}
                    </td>
                    <td>
                      {task.assignedTo ? (
                        <div>
                          <div className="font-medium text-xs">{task.assignedTo.name}</div>
                          <div className="text-xs text-muted">{task.assignedTo.staffId}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted italic">Unassigned</span>
                      )}
                    </td>
                    <td className="text-xs">
                      {task.dueDate ? new Date(task.dueDate).toLocaleDateString("en-IN") : "—"}
                    </td>
                    <td>
                      <span
                        className={`badge text-xs font-semibold px-2 py-0.5 ${
                          task.status === "VERIFIED"
                            ? "bg-emerald-100 text-emerald-800"
                            : task.status === "COMPLETED"
                            ? "bg-blue-100 text-blue-800"
                            : task.status === "IN_PROGRESS"
                            ? "bg-amber-100 text-amber-800"
                            : task.status === "CANCELLED"
                            ? "bg-slate-100 text-slate-600"
                            : "bg-yellow-100 text-yellow-900"
                        }`}
                      >
                        {task.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="text-right space-x-1.5">
                      {task.status === "PENDING" && (
                        <button
                          onClick={() => handleUpdateStatus(task.id, "IN_PROGRESS")}
                          className="btn-secondary py-1 px-2.5 text-xs text-amber-800 border-amber-300"
                        >
                          Start
                        </button>
                      )}
                      {task.status === "IN_PROGRESS" && (
                        <button
                          onClick={() => handleUpdateStatus(task.id, "COMPLETED")}
                          className="btn-secondary py-1 px-2.5 text-xs text-blue-800 border-blue-300"
                        >
                          Complete
                        </button>
                      )}
                      {task.status === "COMPLETED" && (
                        <button
                          onClick={() => handleUpdateStatus(task.id, "VERIFIED")}
                          className="btn-primary py-1 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                        >
                          Verify & Close
                        </button>
                      )}
                      {task.status !== "VERIFIED" && task.status !== "CANCELLED" && (
                        <button
                          onClick={() => handleUpdateStatus(task.id, "CANCELLED")}
                          className="btn-secondary py-1 px-2 text-xs text-rose-600 border-rose-300"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Task Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg space-y-4 bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <h2 className="text-base font-bold">Delegate Operations Task</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-muted hover:text-foreground">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Task Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Conduct Physical Count of Rice & Grains Aisle"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Description & Instructions *</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Detail step-by-step instructions or requirements..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold mb-1">Target Department</label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="input w-full"
                  >
                    <option value="">All / Operations</option>
                    <option value="INVENTORY">Inventory</option>
                    <option value="QC">QC & Picking</option>
                    <option value="BILLING">Billing / Sales</option>
                    <option value="PROCUREMENT">Procurement</option>
                    <option value="FINANCE">Finance</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="input w-full"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent 🔴</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold mb-1">Assign Staff Member</label>
                  <select
                    value={assignedToId}
                    onChange={(e) => setAssignedToId(e.target.value)}
                    className="input w-full"
                  >
                    <option value="">Unassigned</option>
                    {data.staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.staffId} - {s.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1">Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="input w-full"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">Additional Notes</label>
                <input
                  type="text"
                  placeholder="Optional reference links or notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input w-full"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary bg-primary text-white font-bold"
                >
                  {saving ? "Creating…" : "Assign Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
