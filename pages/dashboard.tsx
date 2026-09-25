import { Box, Button, Flex, Grid, Heading, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import moment from 'moment';
import NextLink from 'next/link';
import { useEffect, useState } from 'react';
import { FiArrowRight } from 'react-icons/fi';

import { TrackingMetrics } from '../apiUtils/database/DatabaseInterface';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';
import ProtectedRoute from '../components/ProtectedRoute';
import { formatFileSize, Release } from '../components/releases';
import { AllTrackingResponse } from './api/tracking/all';

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(31,157,85,.55); }
  70% { box-shadow: 0 0 0 7px rgba(31,157,85,0); }
  100% { box-shadow: 0 0 0 0 rgba(31,157,85,0); }
`;

export default function Dashboard() {
  const [totalDownloaded, setTotalDownloaded] = useState(0);
  const [iosDownloads, setIosDownloads] = useState(0);
  const [androidDownloads, setAndroidDownloads] = useState(0);
  const [totalReleases, setTotalReleases] = useState(0);
  const [monthlyInstallations, setMonthlyInstallations] = useState(0);
  const [latestRelease, setLatestRelease] = useState<Release | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const fetchData = async () => {
    try {
      const [response, monthlyResponse, releasesResponse] = await Promise.all([
        fetch('/api/tracking/all'),
        fetch('/api/tracking/monthly'),
        fetch('/api/releases'),
      ]);
      const data = (await response.json()) as AllTrackingResponse;
      const monthlyData = await monthlyResponse.json();
      const releasesData = await releasesResponse.json();
      const currentMonth = new Date().toISOString().slice(0, 7);
      setMonthlyInstallations(
        monthlyData.installations?.find(
          (item: { month: string; count: number }) => item.month === currentMonth
        )?.count ?? 0
      );

      const releases: Release[] = releasesData.releases ?? [];
      setLatestRelease(
        releases.reduce<Release | null>(
          (latest, release) =>
            !latest || new Date(release.timestamp) > new Date(latest.timestamp) ? release : latest,
          null
        )
      );

      setTotalDownloaded(data.trackings.reduce((acc, curr) => acc + curr.count, 0));

      const iosData = data.trackings.filter((metric: TrackingMetrics) => metric.platform === 'ios');
      const androidData = data.trackings.filter(
        (metric: TrackingMetrics) => metric.platform === 'android'
      );

      setIosDownloads(iosData.reduce((acc, curr) => acc + curr.count, 0));
      setAndroidDownloads(androidData.reduce((acc, curr) => acc + curr.count, 0));
      setTotalReleases(data.totalReleases);
    } catch (error) {
      console.error('Failed to fetch tracking data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const stats = [
    { label: 'Releases published', value: totalReleases },
    { label: 'Installs, all releases', value: totalDownloaded },
    { label: 'iOS installs', value: iosDownloads },
    { label: 'Android installs', value: androidDownloads },
    { label: 'Unique installs this month', value: monthlyInstallations },
  ];

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
                        Latest release
                      </Text>
                    </Flex>
                    <Text fontSize="sm" color="muted">
                      Shipped {moment(latestRelease.timestamp).fromNow()}
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
                      <Text title={latestRelease.commitHash ?? undefined}>
                        {latestRelease.commitHash?.slice(0, 7) ?? 'no commit'}
                      </Text>
                      <Text>{formatFileSize(latestRelease.size)}</Text>
                      <Text>
                        {moment(latestRelease.timestamp).utc().format('MMM D, HH:mm')} UTC
                      </Text>
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
                  No releases yet
                </Heading>
              )}
            </Box>

            <Grid
              mt={4}
              templateColumns={{ base: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }}
              gap="1px"
              bg="line"
              border="1px solid"
              borderColor="line"
              borderRadius="14px"
              overflow="hidden">
              {stats.map((stat, index) => (
                <Box
                  key={stat.label}
                  bg="panel"
                  px={5}
                  py={5}
                  gridColumn={
                    index === stats.length - 1 ? { base: 'span 2', md: 'auto' } : undefined
                  }>
                  <Text fontSize="xs" color="muted">
                    {stat.label}
                  </Text>
                  <Text
                    mt={2}
                    fontFamily="mono"
                    fontSize="2xl"
                    fontWeight={500}
                    sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {stat.value.toLocaleString()}
                  </Text>
                </Box>
              ))}
            </Grid>
          </>
        )}
      </Layout>
    </ProtectedRoute>
  );
}
