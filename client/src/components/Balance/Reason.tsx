import { useLocalize } from '~/hooks';

const AIS_USE_CASE_URL =
  'https://obgbu.atlassian.net/secure/CreateIssueDetails!init.jspa?pid=10572&issuetype=10859';

interface ReasonProps {
  id: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

export default function Reason({ id, value, placeholder, onChange }: ReasonProps) {
  const localize = useLocalize();
  const guidanceId = `${id}-guidance`;

  return (
    <>
      <label htmlFor={id} className="text-left text-sm font-medium text-text-primary">
        {localize('com_nav_balance_request_reason_label')}
      </label>
      <p id={guidanceId} className="text-left text-sm text-text-secondary">
        {localize('com_nav_balance_request_reason_guidance')}{' '}
        <em>
          <a
            href={AIS_USE_CASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-text-primary underline"
          >
            {localize('com_nav_balance_request_reason_create_link')}
          </a>{' '}
          {localize('com_nav_balance_request_reason_create_suffix')}
        </em>
      </p>
      <textarea
        id={id}
        aria-describedby={guidanceId}
        className="w-full rounded-xl border border-border-light bg-transparent p-2 text-text-primary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        maxLength={500}
        placeholder={placeholder}
      />
    </>
  );
}
