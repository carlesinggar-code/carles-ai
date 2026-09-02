interface LogoProps {
  size?: number;
  withText?: boolean;
  className?: string;
}

/**
 * Logo minimalis: bentuk geometris sederhana (lingkaran terpotong,
 * terinspirasi gaya wordmark AI modern seperti Claude/OpenAI —
 * bukan tiruan langsung, cuma prinsip "simple geometric mark").
 */
export default function Logo({ size = 28, withText = true, className = "" }: LogoProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="32" height="32" rx="9" fill="var(--accent)" />
        <path
          d="M20.5 10.5C19.2 9.2 17.4 8.4 15.5 8.4C11.6 8.4 8.4 11.6 8.4 15.5C8.4 19.4 11.6 22.6 15.5 22.6C17.4 22.6 19.2 21.8 20.5 20.5"
          stroke="white"
          strokeWidth="2.3"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="21.6" cy="15.5" r="1.9" fill="white" />
      </svg>
      {withText && (
        <span className="font-semibold text-[15px] tracking-tight">
          Carles<span className="text-accent">.ai</span>
        </span>
      )}
    </div>
  );
}
