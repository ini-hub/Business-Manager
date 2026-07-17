export function getStatusColor(status: string): string {
  switch (status) {
    case "pending": return "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400";
    case "confirmed": return "bg-blue-500/20 text-blue-700 dark:text-blue-400";
    case "in_progress": return "bg-purple-500/20 text-purple-700 dark:text-purple-400";
    case "completed": return "bg-green-500/20 text-green-700 dark:text-green-400";
    case "cancelled": return "bg-red-500/20 text-red-700 dark:text-red-400";
    case "no_show": return "bg-orange-500/20 text-orange-700 dark:text-orange-400";
    case "rescheduled": return "bg-indigo-500/20 text-indigo-700 dark:text-indigo-400";
    default: return "bg-gray-500/20 text-gray-700 dark:text-gray-400";
  }
}
