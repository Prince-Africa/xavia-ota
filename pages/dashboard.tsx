import { Card, CardHeader, Heading, CardBody, SimpleGrid } from '@chakra-ui/react';
import Layout from '../components/Layout';
import ProtectedRoute from '../components/ProtectedRoute';
import { TrackingMetrics } from '../apiUtils/database/DatabaseInterface';
import { useEffect, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import { AllTrackingResponse } from './api/tracking/all';

export default function Dashboard() {
  const [totalDownloaded, setTotalDownloaded] = useState(0);
  const [iosDownloads, setIosDownloads] = useState(0);
  const [androidDownloads, setAndroidDownloads] = useState(0);
  const [totalReleases, setTotalReleases] = useState(0);
  const [monthlyInstallations, setMonthlyInstallations] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const fetchData = async () => {
    try {
      const [response, monthlyResponse] = await Promise.all([
        fetch('/api/tracking/all'),
        fetch('/api/tracking/monthly'),
      ]);
      const data = (await response.json()) as AllTrackingResponse;
      const monthlyData = await monthlyResponse.json();
      const currentMonth = new Date().toISOString().slice(0, 7);
      setMonthlyInstallations(
        monthlyData.installations?.find(
          (item: { month: string; count: number }) => item.month === currentMonth
        )?.count ?? 0
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

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <ProtectedRoute>
      <Layout alignItems="center">
        <SimpleGrid columns={2} spacing={4} mt={4}>
          <Card bg="primary.500" textColor="white" variant="outline">
            <CardHeader textAlign="center">
              <Heading size="md">Total Releases</Heading>
            </CardHeader>
            <CardBody textAlign="center">
              <Heading size="lg">{totalReleases}</Heading>
            </CardBody>
          </Card>

          <Card bg="primary.500" textColor="white" variant="outline">
            <CardHeader textAlign="center">
              <Heading size="md">Installations Across Releases</Heading>
            </CardHeader>
            <CardBody textAlign="center">
              <Heading size="lg">{totalDownloaded}</Heading>
            </CardBody>
          </Card>

          <Card bg="primary.500" textColor="white" variant="outline">
            <CardHeader textAlign="center">
              <Heading size="md">iOS Installations Across Releases</Heading>
            </CardHeader>
            <CardBody textAlign="center">
              <Heading size="lg">{iosDownloads}</Heading>
            </CardBody>
          </Card>

          <Card bg="primary.500" textColor="white" variant="outline">
            <CardHeader textAlign="center">
              <Heading size="md">Android Installations Across Releases</Heading>
            </CardHeader>
            <CardBody textAlign="center">
              <Heading size="lg">{androidDownloads}</Heading>
            </CardBody>
          </Card>

          <Card bg="primary.500" textColor="white" variant="outline">
            <CardHeader textAlign="center">
              <Heading size="md">Unique Installations This Month</Heading>
            </CardHeader>
            <CardBody textAlign="center">
              <Heading size="lg">{monthlyInstallations}</Heading>
            </CardBody>
          </Card>
        </SimpleGrid>
      </Layout>
    </ProtectedRoute>
  );
}
