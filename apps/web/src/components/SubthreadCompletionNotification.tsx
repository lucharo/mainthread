import { type ThreadCreatedNotification as Notification } from '../store/threadStore';

interface SubthreadCompletionNotificationProps {
  notification: Notification;
  onNavigate: (threadId: string) => void;
}

export function SubthreadCompletionNotification({ notification, onNavigate }: SubthreadCompletionNotificationProps) {
  const isDone = notification.status === 'done';
  const isBlocked = notification.status === 'needs_attention';

  // Determine icon, color, and label based on status
  const getStatusConfig = () => {
    if (isDone) {
      return {
        bgColor: 'bg-green-500',
        textColor: 'text-green-600 dark:text-green-400',
        label: 'completed',
        icon: (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ),
      };
    }
    // needs_attention - show stop sign for blocked
    return {
      bgColor: 'bg-red-500',
      textColor: 'text-red-600 dark:text-red-400',
      label: 'blocked',
      icon: (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z" />
        </svg>
      ),
    };
  };

  const config = getStatusConfig();

  return (
    <div className="my-2">
      <button
        onClick={() => onNavigate(notification.threadId)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
      >
        {/* Status indicator */}
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0 ${config.bgColor}`}>
          {config.icon}
        </span>

        {/* Thread info */}
        <span className="flex-1 text-left text-sm flex items-center gap-2 min-w-0">
          <span className="font-mono bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs truncate max-w-[200px]">
            {notification.threadTitle}
          </span>
          <span className={`text-xs ${config.textColor}`}>
            {config.label}
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
