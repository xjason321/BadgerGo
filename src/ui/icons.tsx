import type { ReactNode } from "react";

/** Small line icons (24x24, drawn with currentColor). */
const I = (children: ReactNode) =>
  function Icon({ size = 18, className }: { size?: number; className?: string }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {children}
      </svg>
    );
  };

export const WalkIcon = I(<><circle cx="13" cy="4.5" r="1.8" /><path d="M9 21l2.5-6.5M11.5 14.5 10 11l3.5-2.5 2 3.5 3 1M10 11 7 13M13 14.5l1.5 2.5 .5 4" /></>);
export const BikeIcon = I(<><circle cx="5.5" cy="17" r="3.5" /><circle cx="18.5" cy="17" r="3.5" /><path d="M5.5 17 9 9h5.5l4 8M9 9 7.5 6H5.5M14.5 9l-3 8M13 6h2.5" /></>);
export const DockIcon = I(<><rect x="4" y="3.5" width="16" height="17" rx="4.5" /><path d="M9.5 8v8M9.5 8h3.3a2.2 2.2 0 0 1 0 4.4H9.5m3.6 0a2.2 2.2 0 0 1 0 4.4H9.5" /></>);
export const SwapIcon = I(<><path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5" /></>);
export const ClockIcon = I(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const RouteIcon = I(<><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7" /></>);
export const DollarIcon = I(<><path d="M12 3v18M16.5 7.5C15.5 6.4 14 6 12.2 6 10 6 8.3 7.1 8.3 8.8s1.5 2.5 3.7 3 3.7 1.3 3.7 3.1S14 18 11.8 18c-1.8 0-3.4-.5-4.5-1.7" /></>);
export const CheckIcon = I(<><path d="m5 12.5 4.5 4.5L19 7.5" /></>);
export const AlertIcon = I(<><path d="M12 4 2.8 19.5h18.4L12 4Z" /><path d="M12 10v4.5M12 17.2v.1" /></>);
export const PinIcon = I(<><path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></>);
export const TargetIcon = I(<><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></>);
export const SearchIcon = I(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>);
export const ExternalIcon = I(<><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>);
export const InfoIcon = I(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><circle cx="12" cy="7.7" r=".6" fill="currentColor" /></>);
export const CloseIcon = I(<><path d="M6 6l12 12M18 6 6 18" /></>);
export const FlagIcon = I(<><path d="M6 21V4M6 5h11l-2 3.5 2 3.5H6" /></>);
export const SunIcon = I(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" /></>);
export const MoonIcon = I(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />);

export const PencilIcon = I(<><path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>);
export const TrashIcon = I(<><path d="M5 7h14M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7" /></>);
