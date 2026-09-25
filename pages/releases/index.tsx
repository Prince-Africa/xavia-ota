import { Box, Flex, IconButton, LinkBox, LinkOverlay, SimpleGrid, Text } from '@chakra-ui/react';
import NextLink from 'next/link';
import moment from 'moment';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiArrowRight, FiRefreshCw } from 'react-icons/fi';

import CommitHash from '../../components/CommitHash';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import ProtectedRoute from '../../components/ProtectedRoute';
import { Release } from '../../components/releases';

interface RuntimeGroup {
  version: string;
  releases: Release[];
  active?: Release;
  latest: Release;
}

export default function ReleasesPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/releases');
      if (!response.ok) throw new Error('Failed to fetch releases');
      const data = await response.json();
      setReleases(data.releases);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runtimes = useMemo(() => {
    const groups = new Map<string, Release[]>();
    for (const release of releases) {
      const group = groups.get(release.runtimeVersion) ?? [];
      group.push(release);
      groups.set(release.runtimeVersion, group);
    }
    return Array.from(groups, ([version, group]): RuntimeGroup => {
      group.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return {
        version,
        releases: group,
        active: group.find((release) => release.status === 'active'),
        latest: group[0],
      };
    }).sort(
      (a, b) => new Date(b.latest.timestamp).getTime() - new Date(a.latest.timestamp).getTime()
    );
  }, [releases]);

  return (
    <ProtectedRoute>
      <Layout>
        <PageHeader
          title="Runtime versions"
          actions={
            <IconButton
              aria-label="Refresh runtimes"
              onClick={refresh}
              variant="solid"
              colorScheme="gray"
              size="sm"
              icon={<FiRefreshCw />}
            />
          }
        />
        <Text color="muted" mb={7}>
          Each runtime has its own OTA history and live release.
        </Text>
        {loading && <LoadingSpinner py={24} />}
        {error && (
          <Text color="primary.300" fontSize="sm">
            Couldn&apos;t load runtime versions. Please refresh.
          </Text>
        )}
        {!loading && !error && runtimes.length === 0 && (
          <Box bg="panel" border="1px solid" borderColor="line" borderRadius="14px" p={8}>
            <Text fontWeight={600}>No runtime versions yet</Text>
            <Text color="muted" fontSize="sm" mt={1}>
              Published OTAs will appear here.
            </Text>
          </Box>
        )}
        {!loading && !error && runtimes.length > 0 && (
          <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4}>
            {runtimes.map((runtime) => (
              <LinkBox
                key={runtime.version}
                bg="panel"
                border="1px solid"
                borderColor="line"
                borderRadius="14px"
                p={{ base: 5, md: 6 }}
                transition="border-color .15s, background .15s"
                _hover={{ borderColor: 'muted', bg: 'tray' }}>
                <Flex align="start" justify="space-between" gap={4}>
                  <Box>
                    <Text
                      color="muted"
                      fontSize="xs"
                      textTransform="uppercase"
                      letterSpacing="wide">
                      Runtime
                    </Text>
                    <LinkOverlay
                      as={NextLink}
                      href={`/releases/${encodeURIComponent(runtime.version)}`}>
                      <Text fontFamily="mono" fontSize="2xl" fontWeight={600} mt={1}>
                        {runtime.version}
                      </Text>
                    </LinkOverlay>
                  </Box>
                  <Flex
                    align="center"
                    gap={2}
                    color={runtime.active ? 'verified.text' : 'muted'}
                    fontSize="xs">
                    {runtime.active && <Box boxSize="6px" borderRadius="full" bg="verified.dot" />}
                    {runtime.active ? 'Live' : 'No live release'}
                  </Flex>
                </Flex>
                <Flex mt={5} pt={4} borderTop="1px solid" borderColor="line" gap={8} wrap="wrap">
                  <Box>
                    <Text color="muted" fontSize="xs">
                      OTA releases
                    </Text>
                    <Text fontFamily="mono" mt={1}>
                      {runtime.releases.length}
                    </Text>
                  </Box>
                  <Box>
                    <Text color="muted" fontSize="xs">
                      Live commit
                    </Text>
                    <Box mt={1} fontFamily="mono" fontSize="sm">
                      {runtime.active ? (
                        <CommitHash
                          hash={runtime.active.commitHash}
                          repositoryUrl={runtime.active.repositoryUrl}
                        />
                      ) : (
                        '—'
                      )}
                    </Box>
                  </Box>
                  <Box>
                    <Text color="muted" fontSize="xs">
                      Last published
                    </Text>
                    <Text mt={1} fontSize="sm">
                      {moment(runtime.latest.timestamp).utcOffset(60).format('MMM D, YYYY HH:mm')}
                    </Text>
                  </Box>
                </Flex>
                <Flex mt={5} color="muted" align="center" gap={2} fontSize="sm">
                  View OTA history <FiArrowRight />
                </Flex>
              </LinkBox>
            ))}
          </SimpleGrid>
        )}
      </Layout>
    </ProtectedRoute>
  );
}
