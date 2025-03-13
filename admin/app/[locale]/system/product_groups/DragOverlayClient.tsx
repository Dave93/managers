'use client';

import React from 'react';
import { DragOverlay, type DragOverlayProps } from '@dnd-kit/core';

// This component is only used on the client side
export default function DragOverlayClient(props: DragOverlayProps) {
    return <DragOverlay {...props} />;
} 