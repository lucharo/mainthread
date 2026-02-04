import { type ThreadCreatedNotification as Notification } from '../store/threadStore';

interface ThreadCreatedNotificationProps {
  notification: Notification;
  onNavigate: (threadId: string) => void;
}

export function ThreadCreatedNotification({ notification, onNavigate }: ThreadCreatedNotificationProps) {
  return (
    <div className="flex justify-start my-2">
      <button
        onClick={() => onNavigate(notification.threadId)}
        className="max-w-[50%] flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
      >
        {/* Status indicator - purple plus for created */}
        <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0 bg-purple-500">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </span>

        {/* Thread info */}
        <span className="flex-1 text-left text-sm flex items-center gap-2 min-w-0">
          <span className="font-mono bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs truncate max-w-[200px]">
            {notification.threadTitle}
          </span>
          <span className="text-xs text-purple-600 dark:text-purple-400">
            spawned
          </span>
        </span>

        {/* Arrow */}
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
