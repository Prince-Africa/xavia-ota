import {
  Box,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Text,
  Button,
  Flex,
  IconButton,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  Tooltip,
} from '@chakra-ui/react';
import moment from 'moment';
import { useEffect, useRef, useState } from 'react';
import { FiRefreshCw, FiRotateCcw } from 'react-icons/fi';

import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';
import ProtectedRoute from '../components/ProtectedRoute';
import { formatFileSize, Release } from '../components/releases';
import { showToast } from '../components/toast';

export default function ReleasesPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<Release | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetchReleases();
  }, []);

  const fetchReleases = async () => {
    try {
      const response = await fetch('/api/releases');
      if (!response.ok) {
        throw new Error('Failed to fetch releases');
      }
      const data = await response.json();
      setReleases(data.releases);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch releases');
    } finally {
      setLoading(false);
    }
  };

  const rollBack = async () => {
    setIsRollingBack(true);
    try {
      const response = await fetch('/api/rollback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: selectedRelease?.path,
          runtimeVersion: selectedRelease?.runtimeVersion,
          commitHash: selectedRelease?.commitHash,
          commitMessage: selectedRelease?.commitMessage,
        }),
      });

      if (!response.ok) {
        throw new Error('Rollback failed');
      }

      showToast('Rolled back. This release is now live.', 'success');
      fetchReleases();
      setIsOpen(false);
    } catch {
      showToast('Roll back failed. The live release is unchanged.', 'error');
    } finally {
      setIsRollingBack(false);
    }
  };

  const sortedReleases = [...releases].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <ProtectedRoute>
      <Layout>
        <PageHeader
          title="Releases"
          actions={
            <IconButton
              aria-label="Refresh releases"
              onClick={fetchReleases}
              variant="solid"
              colorScheme="gray"
              size="sm"
              icon={<FiRefreshCw />}
            />
          }
        />

        {loading && <LoadingSpinner py={24} />}
        {error && (
          <Text color="primary.300" fontSize="sm">
            Couldn't load releases. Check that the storage bucket is reachable, then refresh.
          </Text>
        )}

        {!loading && !error && sortedReleases.length === 0 && (
          <Box bg="panel" border="1px solid" borderColor="line" borderRadius="14px" p={8}>
            <Text fontWeight={600}>No releases yet</Text>
          </Box>
        )}

        {!loading && !error && sortedReleases.length > 0 && (
          <Box
            bg="panel"
            border="1px solid"
            borderColor="line"
            borderRadius="14px"
            overflowX="auto">
            <Table variant="simple">
              <Thead>
                <Tr>
                  <Th>Release</Th>
                  <Th>Runtime</Th>
                  <Th>Commit</Th>
                  <Th>Message</Th>
                  <Th>Published (UTC)</Th>
                  <Th isNumeric>Size</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {sortedReleases.map((release, index) => (
                  <Tr
                    key={release.path}
                    transition="background .15s"
                    _hover={{ bg: 'rgba(255,255,255,.02)' }}
                    _last={{ td: { borderBottom: 'none' } }}>
                    <Td>
                      <Tooltip label={release.path}>
                        <Text fontFamily="mono" fontSize="xs" isTruncated maxW="12rem">
                          {release.path.split('/').pop()}
                        </Text>
                      </Tooltip>
                    </Td>
                    <Td fontFamily="mono" fontSize="xs">
                      {release.runtimeVersion}
                    </Td>
                    <Td>
                      <Tooltip label={release.commitHash} isDisabled={!release.commitHash}>
                        <Text fontFamily="mono" fontSize="xs" color="muted">
                          {release.commitHash?.slice(0, 7) ?? '—'}
                        </Text>
                      </Tooltip>
                    </Td>
                    <Td>
                      <Tooltip label={release.commitMessage} isDisabled={!release.commitMessage}>
                        <Text isTruncated maxW="16rem">
                          {release.commitMessage || '—'}
                        </Text>
                      </Tooltip>
                    </Td>
                    <Td whiteSpace="nowrap" color="muted">
                      {moment(release.timestamp).utc().format('MMM D, HH:mm')}
                    </Td>
                    <Td isNumeric fontFamily="mono" fontSize="xs" color="muted" whiteSpace="nowrap">
                      {formatFileSize(release.size)}
                    </Td>
                    <Td textAlign="right">
                      {index === 0 ? (
                        <Flex
                          display="inline-flex"
                          align="center"
                          gap={2}
                          px={2.5}
                          h="26px"
                          borderRadius="full"
                          bg="verified.bg"
                          border="1px solid"
                          borderColor="verified.border"
                          color="verified.text"
                          fontSize="xs"
                          fontWeight={500}>
                          <Box boxSize="6px" borderRadius="full" bg="verified.dot" />
                          Live
                        </Flex>
                      ) : (
                        <Button
                          variant="outline"
                          size="xs"
                          h="26px"
                          px={2.5}
                          color="warning.text"
                          borderColor="rgba(224,180,0,.45)"
                          leftIcon={<FiRotateCcw />}
                          _hover={{ bg: 'warning.hover', borderColor: 'warning.border' }}
                          _active={{ bg: 'warning.hover' }}
                          onClick={() => {
                            setSelectedRelease(release);
                            setIsOpen(true);
                          }}>
                          Roll back
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        )}

        <AlertDialog
          isOpen={isOpen}
          leastDestructiveRef={cancelRef}
          onClose={() => setIsOpen(false)}
          isCentered>
          <AlertDialogOverlay>
            <AlertDialogContent mx={4}>
              <AlertDialogHeader fontSize="lg" fontWeight={600}>
                Roll back to this release?
              </AlertDialogHeader>

              <AlertDialogBody>
                <Box
                  bg="field"
                  border="1px solid"
                  borderColor="line"
                  borderRadius="10px"
                  px={4}
                  py={3}
                  fontFamily="mono"
                  fontSize="xs">
                  <Text color="muted">
                    runtime{' '}
                    <Text as="span" color="white">
                      {selectedRelease?.runtimeVersion}
                    </Text>
                  </Text>
                  <Text color="muted" mt={1} wordBreak="break-all">
                    commit{' '}
                    <Text as="span" color="white">
                      {selectedRelease?.commitHash ?? 'unknown'}
                    </Text>
                  </Text>
                </Box>
                <Box
                  mt={3}
                  bg="warning.bg"
                  border="1px solid"
                  borderColor="rgba(224,180,0,.35)"
                  borderRadius="10px"
                  px={4}
                  py={3}
                  color="warning.text"
                  fontSize="sm">
                  This build becomes the live release with a new timestamp. Devices pick it up on
                  their next update check.
                </Box>
              </AlertDialogBody>

              <AlertDialogFooter gap={3}>
                <Button
                  ref={cancelRef}
                  variant="ghost"
                  colorScheme="gray"
                  onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button colorScheme="primary" isLoading={isRollingBack} onClick={rollBack}>
                  Roll back
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialogOverlay>
        </AlertDialog>
      </Layout>
    </ProtectedRoute>
  );
}
