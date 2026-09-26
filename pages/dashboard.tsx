import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Link,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
} from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import moment from 'moment';
import NextLink from 'next/link';
import { useEffect, useState } from 'react';
import { FiArrowRight } from 'react-icons/fi';

import CommitHash from '../components/CommitHash';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';
import ProtectedRoute from '../components/ProtectedRoute';
import { formatFileSize, Release } from '../components/releases';
import { formatUtcTimestamp } from '../components/time';

interface ReleasePlatformMetrics {
  releaseId: string;
  runtimeVersion: string;
  updateId: string | null;
  status: string;
  publishedAt: string;
  platform: string;
  uniqueInstallations: number;
  manifestRequests: number;
  downloadAttempts: number;
  assetRequests: number;
  bytesTransferred: number;
}

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(31,157,85,.55); }
  70% { box-shadow: 0 0 0 7px rgba(31,157,85,0); }
  100% { box-shadow: 0 0 0 0 rgba(31,157,85,0); }
`;

export default function Dashboard() {
  const [uniqueInstallations, setUniqueInstallations] = useState(0);
  const [releaseMetrics, setReleaseMetrics] = useState<ReleasePlatformMetrics[]>([]);
  const [totalReleases, setTotalReleases] = useState(0);
  const [monthlyInstallations, setMonthlyInstallations] = useState(0);
  const [activeReleases, setActiveReleases] = useState<Release[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const fetchData = async () => {
    try {
      const [response, monthlyResponse, releasesResponse] = await Promise.all([
        fetch('/api/tracking/summary'),
        fetch('/api/tracking/monthly'),
        fetch('/api/releases'),
      ]);
      if (!response.ok || !monthlyResponse.ok || !releasesResponse.ok) {
        throw new Error('Failed to fetch dashboard data');
      }
      const data = await response.json();
      const monthlyData = await monthlyResponse.json();
      const releasesData = await releasesResponse.json();
      const currentMonth = moment.utc().format('YYYY-MM');
      setMonthlyInstallations(
        monthlyData.installations?.find(
          (item: { month: string; count: number }) => item.month === currentMonth
        )?.count ?? 0
      );

      const releases: Release[] = releasesData.releases ?? [];
      setActiveReleases(releases.filter((release) => release.status === 'active'));
      setReleaseMetrics(data.releases);
      setUniqueInstallations(data.uniqueInstallations);
      setTotalReleases(releases.length);
    } catch (error) {
      console.error('Failed to fetch tracking data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const sumMetric = (
    key: 'manifestRequests' | 'downloadAttempts' | 'assetRequests' | 'bytesTransferred'
  ) => releaseMetrics.reduce((total, release) => total + release[key], 0);
  const stats = [
    { label: 'Releases published', value: totalReleases },
    { label: 'Manifest requests', value: sumMetric('manifestRequests') },
    { label: 'Unique installations offered', value: uniqueInstallations },
    { label: 'Download attempts', value: sumMetric('downloadAttempts') },
    { label: 'Asset requests', value: sumMetric('assetRequests') },
    { label: 'Bytes transferred', value: formatFileSize(sumMetric('bytesTransferred')) },
    { label: 'Unique installations this month', value: monthlyInstallations },
    { label: 'Update downloaded', value: 'Needs app acknowledgement' },
    { label: 'Update launched', value: 'Needs app acknowledgement' },
  ];
  const metricsByRuntime = Array.from(new Set(releaseMetrics.map((row) => row.runtimeVersion))).map(
    (version) => ({
      version,
      releases: Array.from(
        new Set(
          releaseMetrics.filter((row) => row.runtimeVersion === version).map((row) => row.releaseId)
        )
      ).map((id) => ({
        id,
        rows: releaseMetrics.filter((row) => row.releaseId === id),
      })),
    })
  );
  const latestRelease = activeReleases.reduce<Release | null>(
    (latest, release) =>
      !latest || new Date(release.timestamp) > new Date(latest.timestamp) ? release : latest,
    null
  );

  return (
    <ProtectedRoute>
      <Layout>
        <PageHeader title="Dashboard" />

        {isLoading ? (
          <LoadingSpinner py={24} />
        ) : (
          <>
            <Box
              position="relative"
              bg="panel"
              border="1px solid"
              borderColor="line"
              borderRadius="14px"
              overflow="hidden"
              p={{ base: 6, md: 8 }}
              _before={{
                content: '""',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                h: '2px',
                bgGradient: 'linear(to-r, primary.500, rgba(200,30,44,.25) 45%, transparent)',
              }}>
              {latestRelease ? (
                <>
                  <Flex justify="space-between" align="center" gap={4} wrap="wrap">
                    <Flex align="center" gap={2.5}>
                      <Box
                        boxSize="7px"
                        borderRadius="full"
                        bg="verified.dot"
                        animation={`${pulse} 2.4s ease-out infinite`}
                      />
                      <Text fontSize="sm" fontWeight={500} color="verified.text">
                        Most recently published active release
                      </Text>
                    </Flex>
                    <Text fontSize="sm" color="muted">
                      Published {formatUtcTimestamp(latestRelease.timestamp)}
                    </Text>
                  </Flex>

                  <Flex align="baseline" gap={3} mt={6} wrap="wrap">
                    <Text fontSize="sm" color="muted">
                      Runtime
                    </Text>
                    <Heading as="p" fontSize={{ base: '4xl', md: '5xl' }} lineHeight={1}>
                      {latestRelease.runtimeVersion}
                    </Heading>
                  </Flex>

                  <Text mt={4} fontSize="lg" noOfLines={2} maxW="68ch">
                    {latestRelease.commitMessage || 'No commit message'}
                  </Text>

                  <Flex
                    mt={8}
                    pt={5}
                    borderTop="1px solid"
                    borderColor="line"
                    justify="space-between"
                    align="center"
                    gap={4}
                    wrap="wrap">
                    <Flex gap={5} fontFamily="mono" fontSize="xs" color="muted" wrap="wrap">
                      <CommitHash
                        hash={latestRelease.commitHash}
                        repositoryUrl={latestRelease.repositoryUrl}
                      />
                      <Text>{formatFileSize(latestRelease.size)}</Text>
                      <Text>{formatUtcTimestamp(latestRelease.timestamp, 'MMM D, HH:mm')}</Text>
                    </Flex>
                    <Button
                      as={NextLink}
                      href="/releases"
                      variant="ghost"
                      colorScheme="gray"
                      size="sm"
                      ml={{ base: -3, md: 0 }}
                      rightIcon={<FiArrowRight />}>
                      Manage releases
                    </Button>
                  </Flex>
                </>
              ) : (
                <Heading as="p" fontSize="xl">
                  No active releases
                </Heading>
              )}
            </Box>

            {activeReleases.length > 0 && (
              <Box
                mt={4}
                bg="panel"
                border="1px solid"
                borderColor="line"
                borderRadius="14px"
                p={{ base: 5, md: 6 }}>
                <Heading as="h2" fontSize="md" mb={4}>
                  Active by runtime
                </Heading>
                {activeReleases.map((release) => (
                  <Flex
                    key={release.id}
                    justify="space-between"
                    gap={4}
                    wrap="wrap"
                    py={3}
                    borderTop="1px solid"
                    borderColor="line">
                    <Link
                      as={NextLink}
                      href={`/releases/${encodeURIComponent(release.runtimeVersion)}`}
                      fontFamily="mono"
                      fontSize="sm">
                      {release.runtimeVersion}
                    </Link>
                    <Text fontFamily="mono" fontSize="xs" color="muted">
                      {release.commitHash || 'Unknown commit'}
                    </Text>
                    <Text fontFamily="mono" fontSize="xs" color="muted">
                      {release.updateId || 'Update ID pending'}
                    </Text>
                  </Flex>
                ))}
              </Box>
            )}

            <Grid
              mt={4}
              templateColumns={{ base: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }}
              gap="1px"
              bg="line"
              border="1px solid"
              borderColor="line"
              borderRadius="14px"
              overflow="hidden">
              {stats.map((stat) => (
                <Box key={stat.label} bg="panel" px={5} py={5}>
                  <Text fontSize="xs" color="muted">
                    {stat.label}
                  </Text>
                  <Text
                    mt={2}
                    fontFamily="mono"
                    fontSize={typeof stat.value === 'number' ? '2xl' : 'sm'}
                    fontWeight={500}
                    sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
                  </Text>
                </Box>
              ))}
            </Grid>
            <Text color="muted" fontSize="xs" mt={3}>
              Download attempts start with the first asset request per installation and release.
              Bytes transferred count asset responses sent by this server.
            </Text>

            <Heading as="h2" fontSize="lg" mt={10} mb={4}>
              Metrics by runtime and release
            </Heading>
            {metricsByRuntime.map((runtime) => (
              <Box
                key={runtime.version}
                bg="panel"
                border="1px solid"
                borderColor="line"
                borderRadius="14px"
                mb={4}
                overflow="hidden">
                <Flex
                  align="center"
                  justify="space-between"
                  p={5}
                  borderBottom="1px solid"
                  borderColor="line">
                  <Heading as="h3" fontSize="md">
                    Runtime{' '}
                    <Text as="span" fontFamily="mono">
                      {runtime.version}
                    </Text>
                  </Heading>
                  <Link
                    as={NextLink}
                    href={`/releases/${encodeURIComponent(runtime.version)}`}
                    color="muted"
                    fontSize="sm">
                    View OTAs
                  </Link>
                </Flex>
                {runtime.releases.map((release) => (
                  <Box
                    key={release.id}
                    p={5}
                    borderBottom="1px solid"
                    borderColor="line"
                    _last={{ borderBottom: 'none' }}>
                    <Flex align="center" gap={4} wrap="wrap" mb={3}>
                      <Text fontFamily="mono" fontSize="xs" wordBreak="break-all">
                        {release.rows[0].updateId || release.id}
                      </Text>
                      <Text
                        color={release.rows[0].status === 'active' ? 'verified.text' : 'muted'}
                        fontSize="xs">
                        {release.rows[0].status === 'active' ? 'Live' : 'Inactive'}
                      </Text>
                      <Text color="muted" fontSize="xs">
                        {formatUtcTimestamp(release.rows[0].publishedAt)}
                      </Text>
                    </Flex>
                    <Box overflowX="auto">
                      <Table size="sm" variant="simple">
                        <Thead>
                          <Tr>
                            <Th>Platform</Th>
                            <Th isNumeric>Unique installations offered</Th>
                            <Th isNumeric>Manifest requests</Th>
                            <Th isNumeric>Download attempts</Th>
                            <Th isNumeric>Asset requests</Th>
                            <Th isNumeric>Bytes transferred</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {release.rows.map((row) => (
                            <Tr key={row.platform} _last={{ td: { borderBottom: 'none' } }}>
                              <Td>{row.platform === 'ios' ? 'iOS' : 'Android'}</Td>
                              <Td isNumeric fontFamily="mono">
                                {row.uniqueInstallations.toLocaleString()}
                              </Td>
                              <Td isNumeric fontFamily="mono">
                                {row.manifestRequests.toLocaleString()}
                              </Td>
                              <Td isNumeric fontFamily="mono">
                                {row.downloadAttempts.toLocaleString()}
                              </Td>
                              <Td isNumeric fontFamily="mono">
                                {row.assetRequests.toLocaleString()}
                              </Td>
                              <Td isNumeric fontFamily="mono">
                                {formatFileSize(row.bytesTransferred)}
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </Box>
                  </Box>
                ))}
              </Box>
            ))}
          </>
        )}
      </Layout>
    </ProtectedRoute>
  );
}
