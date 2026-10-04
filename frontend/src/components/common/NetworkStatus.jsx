import { HiWifi, HiStatusOffline } from 'react-icons/hi';
import useNetworkStatus from '../../hooks/useNetworkStatus';

export default function NetworkStatus() {
  const { showNotif, notifType } = useNetworkStatus();

  // Nothing to show until the connection status has changed at least once
  if (!notifType) return null;

  const isOffline = notifType === 'offline';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!showNotif}
      className={`fixed bottom-6 z-[9999] flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg transition-all duration-500 ease-out ${
        showNotif ? 'left-6 opacity-100 visible' : '-left-80 opacity-0 invisible pointer-events-none'
      } ${
        isOffline
          ? 'bg-red-600 text-white'
          : 'bg-green-600 text-white'
      }`}
    >
      {isOffline ? (
        <HiStatusOffline className="w-5 h-5 flex-shrink-0 animate-pulse" />
      ) : (
        <HiWifi className="w-5 h-5 flex-shrink-0" />
      )}
      {showNotif && (
        <span className="text-sm font-medium whitespace-nowrap">
          {isOffline ? 'Koneksi internet terputus' : 'Koneksi internet pulih'}
        </span>
      )}
    </div>
  );
}
