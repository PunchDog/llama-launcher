import { btnPrimary, btnDanger, btnSecondary, btnGhost } from './styles';

// =============================================================================
// Button — 统一按钮（主色 / 危险 / 次要 / 幽灵）
// =============================================================================

type Variant = 'primary' | 'danger' | 'secondary' | 'ghost';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: Variant;
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: 'button' | 'submit';
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: btnPrimary,
  danger: btnDanger,
  secondary: btnSecondary,
  ghost: btnGhost,
};

export default function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  title,
  className = '',
  type = 'button',
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${VARIANT_CLASS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
