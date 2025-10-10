import ReportsPageClient from "./page.client";

interface paramsProps {
  terminalid: string;
  id: string;
}

interface PageProps {
  params: Promise<paramsProps>;
}

export default async function ReportsPage(props: PageProps) {

  const { terminalid: terminalId, id } = await props.params;

  return (
    <ReportsPageClient terminalid={terminalId} id={id} />
  );
}
