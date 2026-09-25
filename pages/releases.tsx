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

import CommitHash from '../components/CommitHash';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';
import ProtectedRoute from '../components/ProtectedRoute';
import { formatFileSize, Release } from '../components/releases';
import { showToast } from '../components/toast';

interface RollbackPreview {
  runtimeVersion: string;
  current: { id: string; commitHash: string; updateId: string; timestamp: string };
  target: { commitHash: string; updateId: string | null; timestamp: string };
  estimatedAffectedInstallations: number;
  archiveAvailable: boolean;
  blockedReason: string | null;
}

export default function ReleasesPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<Release | null>(null);
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
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
    if (!selectedRelease || !rollbackPreview || rollbackPreview.blockedReason) return;
    setIsRollingBack(true);
    try {
      const response = await fetch('/api/rollback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: selectedRelease.path,
          runtimeVersion: selectedRelease.runtimeVersion,
          expectedActiveReleaseId: rollbackPreview.current.id,
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Rollback failed');
      }

      showToast('Rolled back. This release is now live.', 'success');
      fetchReleases();
      setIsOpen(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Rollback failed', 'error');
      if (selectedRelease) openRollback(selectedRelease);
    } finally {
      setIsRollingBack(false);
    }
  };

  const openRollback = async (release: Release) => {
    setSelectedRelease(release);
    setRollbackPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    setIsOpen(true);
    try {
      const query = new URLSearchParams({
        path: release.path,
        runtimeVersion: release.runtimeVersion,
      });
      const response = await fetch(`/api/rollback?${query}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not check rollback');
      setRollbackPreview(result);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Could not check rollback');
    } finally {
      setPreviewLoading(false);
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
                  <Th>Published</Th>
                  <Th isNumeric>Size</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {sortedReleases.map((release) => (
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
                        <Box as="span" display="inline-block">
                          <CommitHash
                            hash={release.commitHash}
                            repositoryUrl={release.repositoryUrl}
                            fontFamily="mono"
                            fontSize="xs"
                            color="muted"
                          />
                        </Box>
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
                      {moment(release.timestamp).utcOffset(60).format('MMM D, HH:mm')}
                    </Td>
                    <Td isNumeric fontFamily="mono" fontSize="xs" color="muted" whiteSpace="nowrap">
                      {formatFileSize(release.size)}
                    </Td>
                    <Td textAlign="right">
                      {release.status === 'active' ? (
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
                          onClick={() => openRollback(release)}>
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
                {previewLoading && <LoadingSpinner py={8} />}
                {previewError && <Text color="warning.text">{previewError}</Text>}
                {rollbackPreview && (
                  <Box>
                    <Text fontSize="sm" color="muted" mb={3}>
                      Runtime{' '}
                      <Text as="span" fontFamily="mono" color="white">
                        {rollbackPreview.runtimeVersion}
                      </Text>
                    </Text>
                    {(
                      [
                        ['Current active', rollbackPreview.current],
                        ['Rollback target', rollbackPreview.target],
                      ] as const
                    ).map(([label, release]) => (
                      <Box
                        key={label}
                        bg="field"
                        border="1px solid"
                        borderColor="line"
                        borderRadius="10px"
                        px={4}
                        py={3}
                        mb={3}>
                        <Text fontSize="xs" color="muted" mb={2}>
                          {label}
                        </Text>
                        <Text fontSize="xs" fontFamily="mono" wordBreak="break-all">
                          Commit: {release.commitHash || 'unknown'}
                        </Text>
                        <Text fontSize="xs" fontFamily="mono" wordBreak="break-all">
                          Update ID: {release.updateId || 'unavailable'}
                        </Text>
                        <Text fontSize="xs" color="muted" mt={1}>
                          Published:{' '}
                          {moment(release.timestamp).utcOffset(60).format('MMM D, YYYY HH:mm')}
                        </Text>
                      </Box>
                    ))}
                    <Text fontSize="sm">
                      Estimated affected installations:{' '}
                      <Text as="span" fontFamily="mono">
                        {rollbackPreview.estimatedAffectedInstallations}
                      </Text>
                    </Text>
                    <Text fontSize="xs" color="muted">
                      Based on tracked installations of the current release.
                    </Text>
                    <Text
                      fontSize="sm"
                      mt={2}
                      color={rollbackPreview.archiveAvailable ? 'verified.text' : 'warning.text'}>
                      Archive: {rollbackPreview.archiveAvailable ? 'Available' : 'Unavailable'}
                    </Text>
                    {rollbackPreview.blockedReason && (
                      <Box
                        mt={3}
                        bg="warning.bg"
                        border="1px solid"
                        borderColor="warning.border"
                        borderRadius="10px"
                        px={4}
                        py={3}
                        color="warning.text"
                        fontSize="sm">
                        {rollbackPreview.blockedReason}
                      </Box>
                    )}
                  </Box>
                )}
              </AlertDialogBody>

              <AlertDialogFooter gap={3}>
                <Button
                  ref={cancelRef}
                  variant="ghost"
                  colorScheme="gray"
                  onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button
                  colorScheme="primary"
                  isLoading={isRollingBack}
                  isDisabled={
                    previewLoading || !rollbackPreview || Boolean(rollbackPreview.blockedReason)
                  }
                  onClick={rollBack}>
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
