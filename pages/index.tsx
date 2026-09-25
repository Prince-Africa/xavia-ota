'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';
import {
  Box,
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Heading,
  Input,
} from '@chakra-ui/react';
import Image from 'next/image';

export default function Home() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error);
      } else {
        localStorage.setItem('isAuthenticated', 'true');
        router.push('/dashboard');
      }
    } catch (err) {
      setError('Failed to login');
      console.error(err);
    }
  };

  return (
    <Box display="flex" minHeight="100vh" alignItems="center" justifyContent="center" px={5}>
      <Box as="form" onSubmit={handleLogin} w="full" maxW="360px">
        <Image src="/go_logo.svg" width={62} height={40} alt="GO" priority />
        <Heading as="h1" fontSize="2xl" mt={8} mb={8}>
          OTA updates
        </Heading>
        <FormControl isInvalid={!!error} mb={4}>
          <FormLabel fontSize="sm" color="muted" fontWeight={500}>
            Admin password
          </FormLabel>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            size="md"
          />
          {error && <FormErrorMessage>{error}</FormErrorMessage>}
        </FormControl>
        <Button type="submit" colorScheme="primary" width="full">
          Sign in
        </Button>
      </Box>
    </Box>
  );
}
