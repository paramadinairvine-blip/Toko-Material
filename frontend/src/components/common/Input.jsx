import { forwardRef } from 'react';

const Input = forwardRef(function Input(
  {
    label,
    error,
    helperText,
    type = 'text',
    textarea = false,
    icon: Icon,
    iconRight: IconRight,
    disabled = false,
    className = '',
    id,
    ...props
  },
  ref
) {
  const inputId = id || props.name || label?.toLowerCase().replace(/\s/g, '-');
  // Accept both <Input type="textarea" /> and <Input textarea />; `textarea` must not reach the DOM
  const isTextarea = textarea || type === 'textarea';

  const baseClasses =
    'w-full rounded-lg border text-sm transition-colors outline-none disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed';
  const stateClasses = error
    ? 'border-red-300 focus:ring-2 focus:ring-red-500 focus:border-red-500'
    : 'border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
  const paddingClasses = Icon
    ? 'pl-10 pr-4 py-2.5'
    : IconRight
      ? 'pl-4 pr-10 py-2.5'
      : 'px-4 py-2.5';

  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <Icon className="w-5 h-5" />
          </div>
        )}
        {isTextarea ? (
          <textarea
            ref={ref}
            id={inputId}
            disabled={disabled}
            className={`${baseClasses} ${stateClasses} px-4 py-2.5 min-h-[80px] resize-y`}
            {...props}
          />
        ) : (
          <input
            ref={ref}
            id={inputId}
            type={type}
            disabled={disabled}
            className={`${baseClasses} ${stateClasses} ${paddingClasses}`}
            {...props}
          />
        )}
        {IconRight && !isTextarea && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <IconRight className="w-5 h-5" />
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {!error && helperText && <p className="mt-1 text-xs text-gray-500">{helperText}</p>}
    </div>
  );
});

export default Input;
